import { imageToBase64, type AIOptimizeResult, type AIOptimizeOptions, DEFAULT_AI_PROMPT } from './aiOptimize';

// Keys never enter the PinDou server: custom image editing runs in the browser.
export interface CustomAIProvider {
  endpoint: string;
  apiKey: string;
  model: string;
  remember: boolean;
}

export const CUSTOM_PROVIDER_STORAGE_KEY = 'pindou.custom-ai-provider.v1';
const MAX_OUTPUT_BYTES = 30_000_000;

export function getCustomProviderEditUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error('请输入有效的 HTTPS 接入点地址。');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('接入点必须是 HTTPS 地址，且不能包含账号、参数或片段。');
  }
  const base = url.pathname.replace(/\/+$/, '');
  const path = base.endsWith('/images/edits') ? base : base + '/images/edits';
  return url.origin + path;
}

export function normalizeCustomProvider(input: CustomAIProvider): CustomAIProvider {
  const endpoint = input.endpoint.trim().replace(/\/+$/, '');
  getCustomProviderEditUrl(endpoint);
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey || !model) throw new Error('请填写 API Key 和模型名称。');
  if (endpoint.length > 500 || apiKey.length > 1000 || model.length > 150) {
    throw new Error('接入点、Key 或模型名称过长。');
  }
  return { endpoint, apiKey, model, remember: !!input.remember };
}

export function readCustomProvider(): CustomAIProvider | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CUSTOM_PROVIDER_STORAGE_KEY)
      || localStorage.getItem(CUSTOM_PROVIDER_STORAGE_KEY);
    if (!raw) return null;
    return normalizeCustomProvider(JSON.parse(raw) as CustomAIProvider);
  } catch {
    // Storage may be disabled or an earlier value may be corrupt.
    return null;
  }
}

export function saveCustomProvider(input: CustomAIProvider): CustomAIProvider {
  const config = normalizeCustomProvider(input);
  // Only store the key in the explicitly selected browser storage.
  // Remove the other copy when switching between remembered/session-only.
  try {
    if (config.remember) {
      localStorage.setItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(config));
      sessionStorage.removeItem(CUSTOM_PROVIDER_STORAGE_KEY);
    } else {
      sessionStorage.setItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(config));
      localStorage.removeItem(CUSTOM_PROVIDER_STORAGE_KEY);
    }
  } catch {
    throw new Error('浏览器无法保存配置，请检查隐私模式或存储权限。');
  }
  return config;
}

export function clearCustomProvider(): void {
  try {
    sessionStorage.removeItem(CUSTOM_PROVIDER_STORAGE_KEY);
    localStorage.removeItem(CUSTOM_PROVIDER_STORAGE_KEY);
  } catch {
    // The current React state can still be reset when storage is unavailable.
  }
}

async function imageBlobFromDataUrl(dataUrl: string): Promise<Blob> {
  // The existing image pipeline keeps the submitted crop while capping the
  // upload at 2048px / ~4MB; avoid EdgeOne's 6MB request cap for custom models.
  const response = await fetch(dataUrl);
  return response.blob();
}

async function readImageBlob(blob: Blob): Promise<string> {
  if (blob.size === 0 || blob.size > MAX_OUTPUT_BYTES) {
    throw new Error('供应商返回的图片为空或过大。');
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
    throw new Error('供应商返回的文件不是受支持的图片。');
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('无法读取供应商生成的图片。'));
    reader.onerror = () => reject(new Error('无法读取供应商生成的图片。'));
    reader.readAsDataURL(blob);
  });
}

function base64ImageDataUrl(base64: string): string {
  if (base64.length > Math.ceil(MAX_OUTPUT_BYTES * 4 / 3) + 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('供应商返回了无效的图片数据。');
  }
  // The declared output_format is not always reliable; sniff well-known base64
  // magic headers rather than assuming every image is PNG.
  const mime = base64.startsWith('iVBORw0KGgo') ? 'image/png'
    : base64.startsWith('/9j/') ? 'image/jpeg'
    : base64.startsWith('UklGR') ? 'image/webp' : null;
  if (!mime) throw new Error('供应商返回了未知图片格式。');
  return `data:${mime};base64,${base64}`;
}

async function readGeneratedResult(response: Response, signal: AbortSignal): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) return readImageBlob(await response.blob());

  const data = await response.json() as {
    data?: Array<{ b64_json?: string; url?: string }>;
    images?: Array<{ b64_json?: string; url?: string }>;
  };
  const item = data.data?.[0] || data.images?.[0];
  if (typeof item?.b64_json === 'string') return base64ImageDataUrl(item.b64_json);

  if (typeof item?.url === 'string') {
    let imageUrl: URL;
    try {
      imageUrl = new URL(item.url);
    } catch {
      throw new Error('供应商返回的图片地址无效。');
    }
    if (imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password) {
      throw new Error('供应商返回的图片地址不安全。');
    }
    const imageResponse = await fetch(imageUrl.href, {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal
    });
    if (!imageResponse.ok) throw new Error('无法下载供应商生成的图片。');
    const imageType = (imageResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const blob = await imageResponse.blob();
    // Some CDNs return application/octet-stream even for a real PNG.
    if (imageType === 'application/octet-stream' || !blob.type) {
      const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const mime = header.length >= 8 && header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71
        ? 'image/png' : header[0] === 255 && header[1] === 216 && header[2] === 255
        ? 'image/jpeg' : String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
        ? 'image/webp' : '';
      if (!mime) throw new Error('供应商返回的文件不是有效图片。');
      return readImageBlob(new Blob([blob], { type: mime }));
    }
    return readImageBlob(blob);
  }
  throw new Error('供应商未返回图片，请确认支持 OpenAI 兼容的图片编辑接口。');
}

export async function optimizeWithCustomProvider(
  imageSrc: string,
  provider: CustomAIProvider,
  options: AIOptimizeOptions = {}
): Promise<AIOptimizeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = normalizeCustomProvider(provider);
    const { onProgress, customPrompt } = options;
    onProgress?.(10);
    const encoded = await imageToBase64(imageSrc);
    const input = await imageBlobFromDataUrl(encoded);
    onProgress?.(30);

    const form = new FormData();
    form.append('model', config.model);
    form.append('prompt', customPrompt || DEFAULT_AI_PROMPT);
    form.append('image', input, input.type === 'image/jpeg' ? 'pindou.jpg' : 'pindou.png');

    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 240_000);
    const response = await fetch(getCustomProviderEditUrl(config.endpoint), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      body: form,
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    onProgress?.(80);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('供应商鉴权失败，请检查 API Key。');
      if (response.status === 402) throw new Error('供应商余额或额度不足。');
      if (response.status === 429) throw new Error('供应商请求过于频繁，请稍后重试。');
      if (response.status >= 500) throw new Error('供应商暂时无法处理请求。');
      throw new Error(`供应商不接受图片编辑请求（HTTP ${response.status}），请检查模型及接入点。`);
    }

    const imageUrl = await readGeneratedResult(response, controller.signal);
    onProgress?.(100);
    return { success: true, imageUrl };
  } catch (error) {
    // Never log or render the user-supplied API Key.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: '自定义模型处理超过 240 秒，请稍后重试。' };
    }
    if (error instanceof TypeError) {
      return { success: false, error: '浏览器无法连接供应商，可能存在网络或 CORS 跨域限制。' };
    }
    return { success: false, error: error instanceof Error ? error.message : '自定义模型请求失败，请重试。' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

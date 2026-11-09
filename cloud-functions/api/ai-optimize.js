// EdgeOne Makers Cloud Function — SiliconFlow image-to-image editing.
// Route: POST /api/ai-optimize
// The API key is NEVER exposed to the browser; add SILICONFLOW_API_KEY in EdgeOne environment settings.

const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/images/generations';
const DEFAULT_MODEL = 'Qwen/Qwen-Image-Edit-2509';
const MAX_REQUEST_BYTES = 5_800_000; // EdgeOne Cloud Functions request limit: 6 MB.
const MAX_IMAGE_DATA_LENGTH = 5_550_000;
const MAX_RESULT_BYTES = 5_500_000; // EdgeOne Cloud Functions response limit: 6 MB.

function jsonError(status, message) {
  return new Response(JSON.stringify({ success: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function parseImageDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_LENGTH) return null;
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return null;
  const header = value.slice(0, commaIndex).toLowerCase();
  if (!['data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'].includes(header)) return null;
  const encoded = value.slice(commaIndex + 1);
  if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;
  return value;
}

function isSafePublicHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    // No IP literal or local host is needed for SiliconFlow's generated-image URLs.
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    if (!host.includes('.') || host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false;
    return true;
  } catch {
    return false;
  }
}

// SiliconFlow's CDN may serve a real PNG with the generic binary content type.
// Trust the file's magic bytes rather than relying on the CDN's Content-Type.
function detectImageMime(bytes) {
  if (bytes.length >= 16 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR') {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

async function downloadGeneratedImage(rawUrl) {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isSafePublicHttpsUrl(currentUrl)) throw new Error('UNSAFE_IMAGE_URL');
    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(12_000),
      redirect: 'manual',
      headers: { Accept: 'image/png,image/jpeg,image/webp' }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('IMAGE_DOWNLOAD_FAILED');
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.ok) throw new Error('IMAGE_DOWNLOAD_FAILED');

    // Do not reject application/octet-stream: SiliconFlow's S3 CDN returns
    // this for genuine PNG files. Inspect the downloaded bytes below instead.
    const declaredType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const knownLength = Number(response.headers.get('content-length') || 0);
    if (knownLength > MAX_RESULT_BYTES) throw new Error('IMAGE_TOO_LARGE');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('IMAGE_DOWNLOAD_FAILED');
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESULT_BYTES) {
        await reader.cancel();
        throw new Error('IMAGE_TOO_LARGE');
      }
      chunks.push(value);
    }
    if (!total) throw new Error('IMAGE_DOWNLOAD_FAILED');
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    const mime = detectImageMime(bytes);
    if (!mime) {
      console.warn('SiliconFlow CDN returned unsupported image bytes', {
        declaredType,
        length: total
      });
      throw new Error('INVALID_IMAGE_TYPE');
    }
    return { bytes, mime };
  }
  throw new Error('IMAGE_REDIRECT_LIMIT');
}

// EdgeOne may rewrite request.url to a platform-internal host while preserving
// the browser's public Origin. Validate against the actual public project domains
// instead of assuming request.url and Origin always have identical hosts.
const PUBLIC_SITE_ORIGINS = new Set([
  'https://pindou.sudashui.online',
  'http://pindou.sudashui.online' // Transitional until HTTPS redirection is enabled.
]);

function isAllowedBrowserOrigin(originHeader, requestUrl, extraOrigins) {
  if (!originHeader) return true; // Origin is a browser CSRF signal, not server authentication.
  try {
    const parsedOrigin = new URL(originHeader);
    // An Origin header must contain only scheme + host (+ optional port).
    if (originHeader !== parsedOrigin.origin || !['http:', 'https:'].includes(parsedOrigin.protocol)) {
      return false;
    }

    const currentRequestOrigin = new URL(requestUrl).origin;
    if (originHeader === currentRequestOrigin || PUBLIC_SITE_ORIGINS.has(originHeader)) {
      return true;
    }

    // Optional exact allowlist for EdgeOne preview or additional custom domains.
    // Comma-separated complete origins: https://preview.example.com,https://...
    const additional = typeof extraOrigins === 'string' ? extraOrigins.split(',') : [];
    return additional.some((candidate) => {
      const value = candidate.trim();
      if (!value) return false;
      try {
        const url = new URL(value);
        return value === url.origin && url.origin === originHeader && url.protocol === 'https:';
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const incomingOrigin = request.headers.get('origin');
  if (!isAllowedBrowserOrigin(
    incomingOrigin,
    request.url,
    env?.AI_ALLOWED_ORIGINS || process.env.AI_ALLOWED_ORIGINS
  )) {
    return jsonError(403, '不允许跨站点调用 AI 服务。');
  }

  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return jsonError(415, '请使用 JSON 格式上传图片。');
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return jsonError(413, '图片过大，请换一张图片重试。');

  const apiKey = env?.SILICONFLOW_API_KEY || process.env.SILICONFLOW_API_KEY;
  if (!apiKey) return jsonError(503, 'AI 服务尚未配置，请在 EdgeOne 中设置 SILICONFLOW_API_KEY。');

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, '图片请求格式有误。');
  }
  const image = parseImageDataUrl(payload?.imageBase64);
  const prompt = payload?.prompt;
  if (!image) return jsonError(400, '请上传有效的 JPG、PNG 或 WEBP 图片（最大约 4MB）。');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > 2000) {
    return jsonError(400, '请提供长度不超过 2000 字符的优化提示词。');
  }

  try {
    const generation = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
        // Keep SiliconFlow's default AI watermark behavior.
      },
      body: JSON.stringify({
        model: env?.SILICONFLOW_IMAGE_MODEL || process.env.SILICONFLOW_IMAGE_MODEL || DEFAULT_MODEL,
        prompt: prompt.trim(),
        image,
        num_inference_steps: 20
        // Edit models do not accept image_size, unlike text-to-image models.
      }),
      signal: AbortSignal.timeout(100_000)
    });

    if (!generation.ok) {
      const traceId = generation.headers.get('x-siliconcloud-trace-id');
      console.warn('SiliconFlow API error', generation.status, traceId || '');
      if (generation.status === 401 || generation.status === 403) {
        return jsonError(502, '硅基流动鉴权失败，请检查 API Key 和账户权限。');
      }
      if (generation.status === 429) return jsonError(429, 'AI 请求过于频繁或额度不足，请稍后重试。');
      if (generation.status >= 500) return jsonError(503, '硅基流动服务暂时繁忙，请稍后再试。');
      return jsonError(502, 'AI 图片编辑请求未成功，请检查模型是否可用。');
    }

    const data = await generation.json();
    const imageUrl = data?.images?.[0]?.url;
    if (typeof imageUrl !== 'string') return jsonError(502, 'AI 已返回结果，但未提供图片地址。');

    const { bytes, mime } = await downloadGeneratedImage(imageUrl);
    // Return image bytes through the SAME origin. This avoids expiring URLs and CORS issues.
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return jsonError(504, 'AI 处理超时，请使用更小的图片或稍后重试。');
    }
    if (error?.message === 'IMAGE_TOO_LARGE') {
      return jsonError(502, 'AI 返回的图片过大，超过当前服务可接收的大小限制。');
    }
    if (error?.message === 'INVALID_IMAGE_TYPE') {
      return jsonError(502, 'AI 图片下载返回了无效格式，请稍后重试。');
    }
    console.error('SiliconFlow request failed:', error instanceof Error ? error.message : String(error));
    return jsonError(502, 'AI 图片编辑失败，请稍后重试。');
  }
}

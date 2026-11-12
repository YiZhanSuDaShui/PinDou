// EdgeOne Makers Cloud Function: POST /api/archive to save a CSV,
// GET /api/archive?code=000000 to restore it.
// Blob is a project-scoped private store; never return a public Blob URL.
import { randomInt } from 'node:crypto';
import { getStore } from '@edgeone/pages-blob';

const STORE_NAME = 'pindou-archives';
const CODE_PATTERN = /^[0-9]{6}$/;
const MAX_CSV_BYTES = 3_000_000;
const MAX_ROWS = 1400;
const MAX_COLUMNS = 400;
const MAX_CELLS = 320_000;
const MAX_ATTEMPTS = 24;
const PUBLIC_ORIGINS = new Set([
  'https://pindou.sudashui.online',
  'http://pindou.sudashui.online'
]);

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function isAllowedOrigin(request, env = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Origin is a CSRF signal, not authentication.
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (origin === new URL(request.url).origin || PUBLIC_ORIGINS.has(origin)) return true;
    const extra = String(env.ARCHIVE_ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    return parsed.protocol === 'https:' && extra.includes(origin);
  } catch {
    return false;
  }
}

// Best-effort per-instance throttling. A six-digit code is not private:
// operators should also enable EdgeOne's project-level anti-bot / rate rules.
const requestsByClient = new Map();
function tooManyRequests(request, kind) {
  const ip = request.headers.get('eo-client-ip')
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const bucket = kind + ':' + ip;
  const now = Date.now();
  const existing = requestsByClient.get(bucket);
  const value = existing && now - existing.start < 60_000
    ? { start: existing.start, count: existing.count + 1 }
    : { start: now, count: 1 };
  requestsByClient.set(bucket, value);
  if (requestsByClient.size > 1500) {
    for (const [key, item] of requestsByClient) {
      if (now - item.start >= 60_000) requestsByClient.delete(key);
    }
  }
  return value.count > (kind === 'save' ? 6 : 12);
}

function normalizeCsv(input) {
  if (typeof input !== 'string' || !input || input.length > MAX_CSV_BYTES) {
    throw new Error('CSV 数据为空或超过 3 MB 限制。');
  }
  // Only ASCII hex or TRANSPARENT tokens are permitted. This also rules out
  // spreadsheet formula injection, CSV quotes and unexpected extra content.
  const text = input.replace(/\r\n/g, '\n').trimEnd();
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    throw new Error('CSV 数据超过 3 MB 限制。');
  }
  const lines = text.split('\n');
  if (lines.length < 1 || lines.length > MAX_ROWS) {
    throw new Error('CSV 图纸行数不受支持。');
  }
  let columns = 0;
  for (const line of lines) {
    const cells = line.split(',');
    if (!columns) columns = cells.length;
    if (cells.length !== columns || columns > MAX_COLUMNS || lines.length * columns > MAX_CELLS) {
      throw new Error('CSV 图纸尺寸无效或过大。');
    }
    if (!cells.every(value => /^#[0-9a-fA-F]{6}$/.test(value) || value === 'TRANSPARENT')) {
      throw new Error('CSV 包含无效颜色值。');
    }
  }
  return text;
}

function objectKey(code) {
  return 'archives/' + code + '.csv';
}

function isConflict(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  return status === 409 || status === 412
    || /already exists|alreadyexist|precondition|condition not met|onlyifnew|conflict/i.test(String(error?.message || ''));
}

// Exported helpers make it possible to test the exact Cloud Function logic with
// an in-memory fake Blob store, without using real free-tier storage in CI.
export async function saveArchive(csv, store, pickCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0')) {
  const safeCsv = normalizeCsv(csv);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = pickCode();
    if (!CODE_PATTERN.test(code)) throw new Error('INVALID_GENERATED_CODE');
    const key = objectKey(code);
    if (await store.get(key, { type: 'text', consistency: 'strong' }) !== null) continue;
    try {
      await store.set(key, safeCsv, { onlyIfNew: true });
    } catch (error) {
      if (isConflict(error)) continue;
      throw error;
    }
    // Defend against SDKs that silently skip conditional writes rather than
    // throw: never hand out a code unless it points to our own saved data.
    const stored = await store.get(key, { type: 'text', consistency: 'strong' });
    if (stored === safeCsv) return code;
  }
  throw new Error('ARCHIVE_CODE_EXHAUSTED');
}

export async function loadArchive(code, store) {
  if (!CODE_PATTERN.test(code)) throw new Error('INVALID_CODE');
  const csv = await store.get(objectKey(code), { type: 'text', consistency: 'strong' });
  if (typeof csv !== 'string') return null;
  return normalizeCsv(csv);
}

export async function onRequestPost(context) {
  const { request, env = {} } = context;
  if (!isAllowedOrigin(request, env)) return json(403, { message: '此来源不能保存图纸。' });
  if (tooManyRequests(request, 'save')) return json(429, { message: '操作太频繁，请稍后再试。' }, { 'Retry-After': '60' });
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json(415, { message: '请发送 JSON 格式的 CSV 数据。' });
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_CSV_BYTES + 1000) {
    return json(413, { message: '图纸数据超过大小限制。' });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { message: '上传的图纸数据格式有误。' });
  }
  let csv;
  try {
    csv = normalizeCsv(body?.csv);
  } catch (error) {
    return json(400, { message: error.message });
  }
  try {
    const code = await saveArchive(csv, context.archiveStore || getStore(STORE_NAME));
    return json(200, { code });
  } catch (error) {
    console.error('Archive write failed:', error?.name || 'UnknownError');
    return json(503, { message: '云端保存暂时不可用，请稍后重试。' });
  }
}

export async function onRequestGet(context) {
  const { request, env = {} } = context;
  if (!isAllowedOrigin(request, env)) return json(403, { message: '此来源不能读取图纸。' });
  if (tooManyRequests(request, 'load')) return json(429, { message: '尝试次数过多，请稍后再试。' }, { 'Retry-After': '60' });
  const code = new URL(request.url).searchParams.get('code');
  if (!CODE_PATTERN.test(code || '')) return json(400, { message: '请输入完整的六位数字对接码。' });
  try {
    const csv = await loadArchive(code, context.archiveStore || getStore(STORE_NAME));
    if (csv === null) return json(404, { message: '未找到对应图纸，请检查六位对接码。' });
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Archive read failed:', error?.name || 'UnknownError');
    return json(503, { message: '云端读取暂时不可用，请稍后重试。' });
  }
}

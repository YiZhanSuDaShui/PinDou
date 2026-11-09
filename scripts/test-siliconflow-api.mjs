import assert from 'node:assert/strict';
import { onRequestPost } from '../cloud-functions/api/ai-optimize.js';

const endpoint = 'https://pindou.sudashui.online/api/ai-optimize';
const inputImage = 'data:image/png;base64,' + Buffer.from('fake-image-data').toString('base64');
const actualPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Wn8AAAAASUVORK5CYII=', 'base64');
const defaultPayload = { imageBase64: inputImage, prompt: '转为干净的拼豆像素风格' };

function createRequest(payload = defaultPayload, headers = {}, requestUrl = endpoint) {
  return new Request(requestUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
}

async function call(payload = defaultPayload, env = { SILICONFLOW_API_KEY: 'test-key' }, headers = {}, requestUrl = endpoint) {
  return onRequestPost({ request: createRequest(payload, headers, requestUrl), env });
}

async function expectJson(response, status, fragment) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.ok(body.message.includes(fragment), JSON.stringify(body));
}

const originalFetch = globalThis.fetch;
let count = 0;

try {
  // Missing credentials should be an explicit configuration error.
  await expectJson(await call(defaultPayload, {}), 503, 'SILICONFLOW_API_KEY');
  await expectJson(await call({ imageBase64: 'https://example.com/a.png', prompt: 'x' }), 400, '有效');
  await expectJson(await call({ imageBase64: inputImage, prompt: '' }), 400, '提示词');
  await expectJson(await call(defaultPayload, { SILICONFLOW_API_KEY: 'test-key' }, { origin: 'https://attacker.invalid' }), 403, '跨站点');

  // EdgeOne reverse proxies can expose an internal request URL while the
  // browser still correctly sends Origin: https://pindou.sudashui.online.
  const proxiedUrl = 'https://internal-edgeone-runtime.example.net/api/ai-optimize';
  await expectJson(
    await call(defaultPayload, {}, { origin: 'https://pindou.sudashui.online' }, proxiedUrl),
    503, 'SILICONFLOW_API_KEY'
  );
  await expectJson(
    await call(defaultPayload, {}, { origin: 'http://pindou.sudashui.online' }, proxiedUrl),
    503, 'SILICONFLOW_API_KEY'
  );
  await expectJson(
    await call(defaultPayload, {}, { origin: 'https://pindou.sudashui.online.evil.example' }, proxiedUrl),
    403, '跨站点'
  );
  await expectJson(
    await call(defaultPayload, {}, { origin: 'https://attacker.invalid' }, proxiedUrl),
    403, '跨站点'
  );
  await expectJson(
    await call(defaultPayload, {}, { origin: 'null' }, proxiedUrl),
    403, '跨站点'
  );
  // Official preview host works directly if the request URL matches it,
  // or can be explicitly allowlisted when the platform rewrites the URL.
  const preview = 'https://pindou-preview.edgeone.cool';
  await expectJson(
    await call(defaultPayload, {}, { origin: preview }, preview + '/api/ai-optimize'),
    503, 'SILICONFLOW_API_KEY'
  );
  await expectJson(
    await call(defaultPayload, { AI_ALLOWED_ORIGINS: preview }, { origin: preview }, proxiedUrl),
    503, 'SILICONFLOW_API_KEY'
  );
  await expectJson(
    await call(defaultPayload, { AI_ALLOWED_ORIGINS: preview }, { origin: 'https://other.edgeone.cool' }, proxiedUrl),
    403, '跨站点'
  );
  console.log('PASS: EdgeOne reverse-proxy custom-domain Origin regression and preview allowlist');

  // Successful editing requests send the input IMAGE (not just a prompt),
  // authenticate server-side, and return a same-origin image byte stream.
  count = 0;
  globalThis.fetch = async (url, init = {}) => {
    count++;
    if (count === 1) {
      assert.equal(url, 'https://api.siliconflow.cn/v1/images/generations');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      const requestBody = JSON.parse(init.body);
      assert.equal(requestBody.model, 'Qwen/Qwen-Image-Edit-2509');
      assert.equal(requestBody.image, inputImage);
      assert.equal(requestBody.prompt, defaultPayload.prompt);
      assert.equal(requestBody.image_size, undefined, 'Edit model must not receive image_size');
      return Response.json({ images: [{ url: 'https://cdn.siliconflow.example.com/generated.png' }] });
    }
    if (count === 2) {
      assert.equal(url, 'https://cdn.siliconflow.example.com/generated.png');
      // Real SiliconFlow S3 URLs often return generic application/octet-stream
      // even when the body is a valid PNG. This used to cause INVALID_IMAGE_TYPE.
      return new Response(actualPng, {
        headers: { 'content-type': 'application/octet-stream' }
      });
    }
    throw new Error('Unexpected fetch call ' + count);
  };
  const success = await call();
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await success.arrayBuffer()), actualPng);
  assert.equal(count, 2);
  console.log('PASS: genuine PNG with application/octet-stream accepted and returned with image/png');

  // The MIME type should come from the body, not from a misleading response header.
  for (const [bytes, expectedMime] of [
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), 'image/jpeg'],
    [Buffer.from('RIFFxxxxWEBP', 'ascii'), 'image/webp']
  ]) {
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? Response.json({ images: [{ url: 'https://cdn.siliconflow.example.com/output' }] })
      : new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
    const result = await call();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), expectedMime);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
    assert.equal(calls, 2);
  }
  console.log('PASS: JPEG and WebP file signatures recognized correctly');

  // Surface upstream quota/rate limit rather than leaking provider secrets.
  globalThis.fetch = async () => new Response('quota exceeded', { status: 429 });
  await expectJson(await call(), 429, '额度');

  // Reject localhost/internal output URLs from any upstream response.
  count = 0;
  globalThis.fetch = async () => {
    count++;
    return Response.json({ images: [{ url: 'http://127.0.0.1/private' }] });
  };
  await expectJson(await call(), 502, '失败');
  assert.equal(count, 1);

  // Reject HTML/errors even when the CDN lies and labels the response image/png.
  for (const declaredType of ['text/html', 'image/png', 'application/octet-stream']) {
    count = 0;
    globalThis.fetch = async () => {
      count++;
      return count === 1
        ? Response.json({ images: [{ url: 'https://cdn.siliconflow.example.com/generated.png' }] })
        : new Response('<html>error</html>', { headers: { 'content-type': declaredType } });
    };
    await expectJson(await call(), 502, '无效格式');
    assert.equal(count, 2);
  }

  console.log('PASS: invalid input, missing key, cross-origin block, upstream errors and unsafe image URLs');
  console.log('PASS: all SiliconFlow API mock tests');
} finally {
  globalThis.fetch = originalFetch;
}

import assert from 'node:assert/strict';
import { onRequestPost } from '../cloud-functions/api/ai-optimize.js';

const endpoint = 'https://pindou.sudashui.online/api/ai-optimize';
const inputImage = 'data:image/png;base64,' + Buffer.from('fake-image-data').toString('base64');
const defaultPayload = { imageBase64: inputImage, prompt: '转为干净的拼豆像素风格' };

function createRequest(payload = defaultPayload, headers = {}) {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
}

async function call(payload = defaultPayload, env = { SILICONFLOW_API_KEY: 'test-key' }, headers = {}) {
  return onRequestPost({ request: createRequest(payload, headers), env });
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
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { 'content-type': 'image/png' }
      });
    }
    throw new Error('Unexpected fetch call ' + count);
  };
  const success = await call();
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await success.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(count, 2);
  console.log('PASS: authenticated SiliconFlow image-edit request and binary response');

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

  // Invalid upstream image data should not be returned as an image.
  count = 0;
  globalThis.fetch = async () => {
    count++;
    return count === 1
      ? Response.json({ images: [{ url: 'https://cdn.siliconflow.example.com/generated.png' }] })
      : new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } });
  };
  await expectJson(await call(), 502, '失败');

  console.log('PASS: invalid input, missing key, cross-origin block, upstream errors and unsafe image URLs');
  console.log('PASS: all SiliconFlow API mock tests');
} finally {
  globalThis.fetch = originalFetch;
}

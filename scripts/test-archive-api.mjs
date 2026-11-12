import assert from 'node:assert/strict';
import {
  saveArchive, loadArchive, onRequestPost, onRequestGet
} from '../cloud-functions/api/archive.js';

// Fake the official Blob API: CI must never use real storage / paid quota.
class InMemoryBlob {
  blobs = new Map();
  reads = [];
  setCalls = [];
  async get(key, options) {
    this.reads.push({ key, options });
    return this.blobs.get(key) ?? null;
  }
  async set(key, value, options) {
    this.setCalls.push({ key, options });
    if (options?.onlyIfNew && this.blobs.has(key)) {
      const error = new Error('Precondition Failed');
      error.status = 412;
      throw error;
    }
    this.blobs.set(key, value);
  }
}

const sample = '#FF0000,TRANSPARENT,#A0B0C0\n#FFFFFF,#000000,TRANSPARENT';
const blob = new InMemoryBlob();
assert.equal(await saveArchive(sample, blob, () => '059864'), '059864');
assert.equal(blob.blobs.get('archives/059864.csv'), sample);
assert.deepEqual(blob.setCalls[0].options, { onlyIfNew: true });
assert.ok(blob.reads.every(x => x.options?.consistency === 'strong'));
assert.equal(await loadArchive('059864', blob), sample);
assert.equal(await loadArchive('000001', blob), null);

let codeIndex = 0;
const next = await saveArchive('#123456', blob, () =>
  ['059864', '002345'][codeIndex++]
);
assert.equal(next, '002345', 'duplicate codes must be retried without overwriting');
assert.equal(blob.blobs.get('archives/059864.csv'), sample);
assert.equal(blob.blobs.get('archives/002345.csv'), '#123456');

await assert.rejects(saveArchive('=HYPERLINK("bad")', blob));
await assert.rejects(saveArchive('#FF0000,TRANSPARENT\n#000000', blob));
await assert.rejects(saveArchive('#ff0000,NOT_VALID', blob));
await assert.rejects(loadArchive('12345', blob));
await assert.rejects(loadArchive('1234567', blob));

function req(path, method = 'GET', body) {
  return new Request('https://pindou.sudashui.online' + path, {
    method,
    headers: {
      Origin: 'https://pindou.sudashui.online',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'x-real-ip': '192.0.2.' + (++req.counter)
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}
req.counter = 0;
const saved = await onRequestPost({
  request: req('/api/archive', 'POST', { csv: sample }), archiveStore: blob
});
assert.equal(saved.status, 200);
const result = await saved.json();
assert.match(result.code, /^[0-9]{6}$/);
const loaded = await onRequestGet({
  request: req('/api/archive?code=' + result.code), archiveStore: blob
});
assert.equal(loaded.status, 200);
assert.match(loaded.headers.get('content-type'), /text\/csv/);
assert.match(loaded.headers.get('cache-control'), /no-store/);
assert.equal(await loaded.text(), sample);
assert.equal((await onRequestGet({ request: req('/api/archive?code=abc123'), archiveStore: blob })).status, 400);
assert.equal((await onRequestGet({ request: req('/api/archive?code=999999'), archiveStore: blob })).status, 404);
assert.equal((await onRequestPost({ request: req('/api/archive', 'POST', { csv: 'oops' }), archiveStore: blob })).status, 400);
assert.equal((await onRequestPost({
  request: new Request('https://pindou.sudashui.online/api/archive', {
    method: 'POST', headers: {
      Origin: 'https://attacker.example', 'Content-Type': 'application/json'
    }, body: JSON.stringify({ csv: sample })
  }),
  archiveStore: blob
})).status, 403);

console.log('PASS: EdgeOne Blob six-digit archive, collision protection, CSV safety, strong reads, save & load routes');

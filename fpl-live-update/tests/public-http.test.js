'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { encodingPreferences, sendPublicJson, sendStaticFile, staticCacheControl, matchesEtag } = require('../public-http');

function response() {
  return { status: null, headers: {}, body: Buffer.alloc(0),
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body == null ? Buffer.alloc(0) : Buffer.from(body); },
  };
}
const request = (headers = {}, method = 'GET') => ({ headers, method });

test('public JSON gzip preserves every field, no-store and exact encoded length', async () => {
  const payload = { meta: { stale: true, updated: '2026-09-07T01:00:00Z' }, players: Array.from({ length: 200 }, (_, id) => ({ id, name: '测试球员', points: id - 3 })) };
  const res = response();
  await sendPublicJson(request({ 'accept-encoding': 'br, gzip, deflate' }), res, 200, payload);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers.Vary, 'Accept-Encoding');
  assert.equal(res.headers['Content-Encoding'], 'gzip');
  assert.equal(res.headers['Content-Length'], res.body.length);
  assert.deepEqual(JSON.parse(gunzipSync(res.body)), payload);
  assert.ok(res.body.length < Buffer.byteLength(JSON.stringify(payload)) / 2);
});

test('encoding negotiation respects exclusions, wildcard, quality and identity fallback', async () => {
  assert.deepEqual(encodingPreferences(''), { gzip: 0, identity: 1 });
  assert.deepEqual(encodingPreferences('GZIP;q=0, *;q=1'), { gzip: 0, identity: 1 });
  assert.deepEqual(encodingPreferences('gzip;q=garbage, identity;q=0.5'), { gzip: 0, identity: 0.5 });
  const payload = { text: 'football '.repeat(500) };
  for (const value of ['', 'br', 'gzip;q=0, *;q=1', 'gzip;q=0.5, identity;q=1']) {
    const res = response();
    await sendPublicJson(request({ 'accept-encoding': value }), res, 200, payload);
    assert.equal(res.headers['Content-Encoding'], undefined);
    assert.deepEqual(JSON.parse(res.body), payload);
    assert.equal(res.headers['Content-Length'], res.body.length);
  }
  const unsupported = response();
  await sendPublicJson(request({ 'accept-encoding': 'br, identity;q=0, gzip;q=0' }), unsupported, 200, payload);
  assert.equal(unsupported.status, 406);
  const tiny = response();
  await sendPublicJson(request({ 'accept-encoding': 'gzip, identity;q=0' }), tiny, 200, { ok: true });
  assert.deepEqual(JSON.parse(gunzipSync(tiny.body)), { ok: true });
});

test('static validators support 304, versioned caches, unchanged image bytes and HTML revalidation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-public-http-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const css = path.join(directory, 'app.css');
  fs.writeFileSync(css, '.test { color: green; }\n'.repeat(200));
  const first = response();
  await sendStaticFile(request({ 'accept-encoding': 'gzip' }), first, css, { contentType: 'text/css', version: '58' });
  assert.equal(first.headers['Cache-Control'], 'public, max-age=3600');
  assert.equal(first.headers['Content-Encoding'], 'gzip');
  assert.equal(gunzipSync(first.body).toString(), fs.readFileSync(css, 'utf8'));
  const cached = response();
  await sendStaticFile(request({ 'if-none-match': first.headers.ETag }), cached, css, { contentType: 'text/css', version: '58' });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  assert.equal(cached.headers['Content-Length'], undefined);
  assert.equal(cached.headers.Vary, 'Accept-Encoding');
  fs.writeFileSync(css, 'changed content');
  const changed = response();
  await sendStaticFile(request({ 'if-none-match': first.headers.ETag }), changed, css, { contentType: 'text/css', version: '58' });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.ETag, first.headers.ETag);
  const image = path.join(directory, 'logo.png');
  const original = Buffer.from([137, 80, 78, 71, 0, 255, 0, 7]);
  fs.writeFileSync(image, original);
  const logo = response();
  await sendStaticFile(request({ 'accept-encoding': 'gzip' }), logo, image, { contentType: 'image/png' });
  assert.deepEqual(logo.body, original);
  assert.equal(logo.headers['Content-Encoding'], undefined);
  assert.equal(logo.headers['Cache-Control'], 'no-cache');
  assert.equal(staticCacheControl('/public/index.html', '58'), 'no-cache');
  assert.equal(staticCacheControl('/public/app.js', 'not-a-version'), 'no-cache');
  assert.equal(matchesEtag('"other", "test"', 'W/"test"'), true);
  assert.equal(matchesEtag('*', 'W/"test"'), true);
});

test('HEAD sends the same representation headers without a body', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-public-head-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'app.js');
  fs.writeFileSync(file, 'var count = 123;\n'.repeat(200));
  const get = response(), head = response();
  const options = { contentType: 'application/javascript', version: '58' };
  await sendStaticFile(request({ 'accept-encoding': 'gzip' }), get, file, options);
  await sendStaticFile(request({ 'accept-encoding': 'gzip' }, 'HEAD'), head, file, options);
  assert.deepEqual(head.headers, get.headers);
  assert.equal(head.body.length, 0);
});

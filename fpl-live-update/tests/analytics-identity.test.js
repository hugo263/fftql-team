'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createInternalTrafficStore, MARKER_MAX_AGE } = require('../analytics-identity');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-analytics-identity-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let clock = 1788590000000;
  const options = { filePath: path.join(folder, 'internal-visitors.json'), secret: 'local-test-secret-only', now: () => clock };
  return { store: createInternalTrafficStore(options), options, advance: (ms) => { clock += ms; } };
}

test('internal marker is signed, purpose-bound, expires and does not use the admin signature', t => {
  const { store, options, advance } = fixture(t);
  const token = store.issueMarker();
  assert.equal(store.verifyMarker(token), true);
  const [payload, signature] = token.split('.');
  const adminSignature = crypto.createHmac('sha256', options.secret).update(payload).digest('base64url');
  assert.notEqual(signature, adminSignature);
  assert.equal(store.verifyMarker(`${payload}.${adminSignature}`), false);
  advance(MARKER_MAX_AGE * 1000);
  assert.equal(store.verifyMarker(token), false);
});

test('forged, malformed, unicode and extra-segment markers fail closed without throwing', t => {
  const { store } = fixture(t);
  const token = store.issueMarker();
  for (const candidate of [undefined, null, '', 'fake', `${token}.extra`, 'x.' + '中'.repeat(43), token.slice(1), 'x'.repeat(2048)]) {
    assert.equal(store.verifyMarker(candidate), false);
  }
});

test('anonymous exclusion identities survive restart and are deduplicated without changing the first date', t => {
  const { store, options, advance } = fixture(t);
  const id = 'a'.repeat(20);
  assert.deepEqual(store.getState().visitorIds, []);
  store.remember(id);
  const since = store.getState().since;
  advance(10_000);
  store.remember(id);
  store.remember('b'.repeat(20));
  const reloaded = createInternalTrafficStore(options).getState();
  assert.deepEqual(reloaded.visitorIds, [id, 'b'.repeat(20)]);
  assert.equal(reloaded.since, since);
  assert.equal(fs.statSync(options.filePath).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(reloaded).includes('local-test-secret'), false);
});

test('returned state cannot mutate the exclusions; no IP or arbitrary identity is accepted', t => {
  const { store } = fixture(t);
  store.remember('a'.repeat(20));
  store.getState().visitorIds.push('b'.repeat(20));
  assert.equal(store.getState().visitorIds.length, 1);
  for (const invalid of ['127.0.0.1', 'someone@example.com', 'a'.repeat(21), 'z'.repeat(20)]) {
    assert.throws(() => store.remember(invalid), /Invalid anonymous/);
  }
});

test('a damaged existing exclusion file cannot silently be reset and overwrite prior identities', t => {
  const { store, options } = fixture(t);
  fs.writeFileSync(options.filePath, '{broken');
  assert.throws(() => store.remember('a'.repeat(20)));
  assert.equal(fs.readFileSync(options.filePath, 'utf8'), '{broken');
});

test('without a configured secret no internal marker can be issued or accepted', t => {
  const { options } = fixture(t);
  const store = createInternalTrafficStore({ ...options, secret: '' });
  assert.throws(() => store.issueMarker(), /unavailable/);
  assert.equal(store.verifyMarker('anything'), false);
});

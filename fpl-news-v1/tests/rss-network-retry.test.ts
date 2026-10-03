import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { collectSource } from '@aihot/backend/sources/collect';
import { guardedFetch } from '@aihot/backend/lib/http-fetch';
import { withNetworkRetry, describeNetworkError, networkErrorCodes } from '@aihot/backend/lib/network-retry';

const coded = (code: string) => Object.assign(new Error('connection failed'), { code });
const dualStackError = () => new TypeError('fetch failed', { cause: Object.assign(new AggregateError([
  coded('ETIMEDOUT'), coded('ENETUNREACH'),
]), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });

test('dual-stack failure triggers exactly one delayed IPv4 fallback attempt', async () => {
  const attempts: boolean[] = [], start = Date.now();
  const result = await withNetworkRetry(async retry => {
    attempts.push(retry);
    if (!retry) throw dualStackError();
    return 'RSS';
  }, AbortSignal.timeout(2000), true);
  assert.equal(result, 'RSS'); assert.deepEqual(attempts, [false, true]);
  assert.ok(Date.now() - start >= 280);
});

test('failure is bounded to two attempts and reports cause codes, not only fetch failed', async () => {
  let calls = 0;
  await assert.rejects(withNetworkRetry(async () => { calls++; throw dualStackError(); }, AbortSignal.timeout(2000), true), error => {
    assert.match((error as Error).message, /已重试 1 次/);
    assert.match((error as Error).message, /ETIMEDOUT/);
    assert.match((error as Error).message, /网络不可达 \(ENETUNREACH\)/);
    return true;
  });
  assert.equal(calls, 2);
});

test('non-opt-in callers retain original error and no retry', async () => {
  let calls = 0; const expected = dualStackError();
  await assert.rejects(withNetworkRetry(async () => { calls++; throw expected; }, AbortSignal.timeout(2000), false), e => e === expected);
  assert.equal(calls, 1);
});

test('certificate, SSRF, unknown and mixed-fatal aggregate errors never retry', async () => {
  for (const error of [coded('EBLOCKED'), coded('CERT_HAS_EXPIRED'), new Error('invalid XML'),
    new AggregateError([coded('ETIMEDOUT'), coded('CERT_HAS_EXPIRED')])]) {
    let calls = 0;
    await assert.rejects(withNetworkRetry(async () => { calls++; throw error; }, AbortSignal.timeout(2000), true));
    assert.equal(calls, 1);
  }
});

test('original deadline includes retry backoff', async () => {
  let calls = 0; const start = Date.now();
  await assert.rejects(withNetworkRetry(async () => { calls++; throw dualStackError(); }, AbortSignal.timeout(80), true));
  assert.equal(calls, 1); assert.ok(Date.now() - start < 1000);
});

test('error diagnostics are bounded, redact root secrets and never include cause messages', () => {
  const cause = Object.assign(new Error('password=private-cause https://user:pass@proxy.test/?token=secret'), { code: 'ECONNRESET' });
  cause.cause = cause;
  const result = describeNetworkError(new Error('fetch https://user:pass@example.org/feed?token=secret Bearer secret-token api_key=abc', { cause }));
  assert.match(result, /连接被重置 \(ECONNRESET\)/);
  assert.doesNotMatch(result, /user:pass|private-cause|secret|api_key=abc|proxy\.test/);
  assert.equal(networkErrorCodes(cause).length, 1);
  assert.ok(describeNetworkError(new Error('a'.repeat(5000), { cause })).length <= 1000);
});

const T = tag(), requests = new Map<string, number>();
const server = http.createServer((req, res) => {
  const route = req.url ?? '/', hits = (requests.get(route) ?? 0) + 1;
  requests.set(route, hits);
  if (route === '/recover' && hits === 1 || ['/broken', '/no-opt', '/post'].includes(route)) { req.socket.destroy(); return; }
  if (route === '/http403') { res.writeHead(403); res.end('forbidden'); return; }
  if (route === '/redirect') { res.writeHead(302, { location: '/recover' }); res.end(); return; }
  if (route === '/large') { res.end('x'.repeat(512)); return; }
  if (route === '/invalid') { res.end('<invalid/>'); return; }
  res.writeHead(200, { 'content-type': 'application/rss+xml', etag: '"recovered"' });
  res.end(`<rss version="2.0"><channel><title>RSS</title><item><title>Network recovery ${T}</title><link>https://example.org/network-recovery-${T}</link></item></channel></rss>`);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await stopBoss(); await closeDb(); });
async function source(suffix: string, route: string) {
  const id = `rss-network-${suffix}-${T}`;
  await sql`INSERT INTO sources (id,name,kind,config,tier,participation_mode,cursor,next_fetch_at)
    VALUES (${id},'Network test','rss',${sql.json({feedUrl:base+route})},'T2','editorial',${sql.json({initializedAt:'2026-01-01T00:00:00Z'})},'2100-01-01')`;
  return id;
}

test('RSS retries an interrupted request through guarded redirect path and records one successful run', async () => {
  const id = await source('recover', '/redirect');
  const result = await collectSource(id);
  assert.equal(result.status, 'ok'); assert.equal(result.found, 1);
  assert.equal(requests.get('/redirect'), 2); assert.equal(requests.get('/recover'), 2);
  const [state] = await sql`SELECT health,fail_count,last_error,cursor FROM sources WHERE id=${id}`;
  assert.equal(state!.health, 'ok'); assert.equal(state!.fail_count, 0); assert.equal(state!.last_error, null);
  assert.equal(state!.cursor.rss.etag, '"recovered"');
  const runs = await sql`SELECT status FROM fetch_runs WHERE source_id=${id}`;
  assert.equal(runs.length, 1); assert.equal(runs[0]!.status, 'ok');
});

test('persistent network failure saves detailed admin error once and preserves success cursor', async () => {
  const id = await source('broken', '/broken');
  const before = (await sql`SELECT cursor FROM sources WHERE id=${id}`)[0]!.cursor;
  const result = await collectSource(id);
  assert.equal(result.status, 'failed'); assert.equal(requests.get('/broken'), 2);
  assert.match(result.error!, /已重试 1 次/); assert.match(result.error!, /UND_ERR_SOCKET|ECONNRESET/);
  const [state] = await sql`SELECT health,fail_count,last_error,cursor FROM sources WHERE id=${id}`;
  assert.equal(state!.fail_count, 1); assert.equal(state!.health, 'degraded');
  assert.equal(state!.last_error, result.error); assert.deepEqual(state!.cursor, before);
  const runs = await sql`SELECT status,error FROM fetch_runs WHERE source_id=${id}`;
  assert.equal(runs.length, 1); assert.equal(runs[0]!.error, result.error);
});

test('HTTP failures, invalid feeds and response-size limits are not retried', async () => {
  for (const route of ['/http403', '/invalid']) {
    const id = await source(route.slice(1), route);
    assert.equal((await collectSource(id)).status, 'failed'); assert.equal(requests.get(route), 1);
  }
  await assert.rejects(guardedFetch(base+'/large', {retryNetworkErrors:true,maxBytes:64}), /Response too large/);
  assert.equal(requests.get('/large'), 1);
});

test('ordinary GET and even opted-in POST requests cannot be automatically replayed', async () => {
  await assert.rejects(guardedFetch(base+'/no-opt'));
  await assert.rejects(guardedFetch(base+'/post', {method:'POST',body:'payload',retryNetworkErrors:true}));
  assert.equal(requests.get('/no-opt'), 1); assert.equal(requests.get('/post'), 1);
});

test('RSS opt-in cannot bypass URL or redirect safety checks', async () => {
  config.allowPrivateNetworkFetch = false;
  try { await assert.rejects(guardedFetch(base+'/blocked', {retryNetworkErrors:true}), /Blocked/); }
  finally { config.allowPrivateNetworkFetch = true; }
  assert.equal(requests.get('/blocked'), undefined);
});

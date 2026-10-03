// Toggle and collection tests use an isolated database and a local X stub, never a live API.
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { paidRequest } from "@aihot/backend/providers/receipts";
import { searchTweets } from "@aihot/backend/providers/socialdata";
import { collectSource, collectXShard, scheduleDueSources } from "@aihot/backend/sources/collect";
import { XCollectionPausedError, xCollectionState } from "@aihot/backend/sources/x-control";
import { setXCollection } from "@aihot/backend/admin/x-collection";
import { previewSource, fetchNow, sourceRuntime } from "@aihot/backend/admin/sources";
import { passwordLogin, SESSION_COOKIE } from "@aihot/backend/admin/auth";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";
import { registerAdmin } from "../apps/api/src/routes/admin.ts";

const T = tag();
const x = `test-x-control-${T}`;
const rss = `test-x-control-rss-${T}`;
const provider = await stub(() => ({ data: [], meta: { result_count: 0 } }));
process.env.X_BEARER_TOKEN = "local-test-token";
process.env.X_API_BASE_URL = provider.url;
process.env.X_API_DAILY_BUDGET_USD = "5";
config.allowPrivateNetworkFetch = true;
let savedState: Awaited<ReturnType<typeof xCollectionState>>;
let savedSources: Array<{ id: string; enabled: boolean; next_fetch_at: Date | null; updated_at: Date }>;

before(async () => {
  savedState = await xCollectionState();
  savedSources = await sql`SELECT id,enabled,next_fetch_at,updated_at FROM sources WHERE kind='x_search'`;
  await sql`UPDATE settings SET value='{"enabled":false,"initialized":false}'::jsonb WHERE key='collection.x'`;
  await sql`INSERT INTO sources(id,name,kind,config,tier,enabled,next_fetch_at)
    VALUES(${x},'X control test','x_search',${sql.json({ query: 'from:SwitchTest' })},'T1',false,'2100-01-01'),
      (${rss},'RSS control test','rss',${sql.json({ feedUrl: provider.url })},'T1',true,'2100-01-01')`;
});
after(async () => {
  process.env.COLLECT_ENABLED = "false";
  for (const s of savedSources) await sql`UPDATE sources SET enabled=${s.enabled},next_fetch_at=${s.next_fetch_at},updated_at=${s.updated_at} WHERE id=${s.id}`;
  await sql`UPDATE settings SET value=${sql.json(savedState)} WHERE key='collection.x'`;
  await sql`DELETE FROM settings WHERE key='heartbeat.worker' AND updated_by=${T}`;
  await sql`DELETE FROM pgboss.job WHERE data->>'sourceId' IN (${x},${rss}) OR singleton_key='x-control-start'`;
  await sql`DELETE FROM sources WHERE id IN (${x},${rss})`;
  await provider.close(); await stopBoss(); await closeDb();
});

test("X defaults off and a missing setting also fails closed", async () => {
  assert.deepEqual(await xCollectionState(), { enabled: false, initialized: false });
  await sql`DELETE FROM settings WHERE key='collection.x'`;
  await assert.rejects(searchTweets('from:SwitchTest', { purpose: 'disabled', subject: x, window: T }), XCollectionPausedError);
  assert.equal(provider.hits(), 0);
});

test("first start enables configured accounts, persists and immediately queues scheduling", async () => {
  await assert.rejects(setXCollection({ enabled: true }, T), /服务器未启用/);
  process.env.COLLECT_ENABLED = "true"; // Mock worker only; no live process or API is started.
  await sql`INSERT INTO settings(key,value,updated_by) VALUES('heartbeat.worker','{}',${T})
    ON CONFLICT(key) DO UPDATE SET updated_at=now(),updated_by=excluded.updated_by`;
  const result = await setXCollection({ enabled: true }, T);
  assert.equal(result.changed, true);
  assert.deepEqual(await xCollectionState(), { enabled: true, initialized: true });
  const [source] = await sql`SELECT enabled,next_fetch_at FROM sources WHERE id=${x}`;
  assert.equal(source!.enabled, true);
  assert.ok(source!.next_fetch_at.getTime() <= Date.now());
  assert.ok((await sql`SELECT id FROM pgboss.job WHERE name='cron.sources.schedule' AND singleton_key='x-control-start'`).length);
  assert.equal((await setXCollection({ enabled: true }, T)).changed, false);
  await searchTweets('from:SwitchTest', { purpose: 'toggle-on', subject: x, window: T });
  assert.equal(provider.hits(), 1);
});

test("off blocks manual previews, forced queued collections, shards and both paid X providers", async () => {
  await setXCollection({ enabled: false }, T);
  const before = provider.hits();
  const [attempts] = await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE service IN ('x_api','socialdata')`;
  const preview = await previewSource({ id: x, kind: 'x_search', config: { query: 'from:SwitchTest' } });
  assert.equal(preview.status, 'failed'); assert.match(preview.error!, /总开关已关闭/);
  await assert.rejects(fetchNow(x, T), XCollectionPausedError);
  assert.equal((await collectSource(x, { force: true })).status, 'skipped');
  assert.equal((await collectXShard(T, [x])).status, 'skipped');
  for (const service of ['x_api', 'socialdata']) {
    await assert.rejects(paidRequest({ service, purpose: 'off', identity: T }, async () => { throw Error('must not call'); }), XCollectionPausedError);
  }
  // Even a cached paid response cannot start a collection through a closed switch.
  await assert.rejects(searchTweets('from:SwitchTest', { purpose: 'toggle-on', subject: x, window: T }), XCollectionPausedError);
  const [after] = await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE service IN ('x_api','socialdata')`;
  assert.equal(after!.n, attempts!.n);
  assert.equal(provider.hits(), before);
  assert.equal((await sql`SELECT fail_count FROM sources WHERE id=${x}`)[0]!.fail_count, 0);
});

test("off removes X from scheduling while ordinary RSS is still scheduled", async () => {
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id IN (${x},${rss})`;
  await scheduleDueSources(1000);
  assert.equal((await sql`SELECT id FROM pgboss.job WHERE name='sources.fetch' AND data->>'sourceId'=${x}`).length, 0);
  assert.ok((await sql`SELECT id FROM pgboss.job WHERE name='sources.fetch' AND data->>'sourceId'=${rss}`).length);
});

test("reopening retains individual pauses and gate changes have an audit trail", async () => {
  await sql`UPDATE sources SET enabled=false WHERE id=${x}`;
  await setXCollection({ enabled: true }, T);
  assert.equal((await sql`SELECT enabled FROM sources WHERE id=${x}`)[0]!.enabled, false);
  const runtime = await sourceRuntime();
  assert.equal(runtime.xCollectionEnabled, true);
  assert.equal(runtime.xDailyBudgetUsd, 5);
  assert.ok(runtime.xUsage.requests >= 1);
  assert.equal((await sql`SELECT id FROM audit_log WHERE actor=${T} AND action='collection.x.toggle'`).length, 3);
});

test("closing lets an existing request finish but rejects every subsequent claim", async () => {
  let sent!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { sent = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const request = paidRequest({ service: 'x_api', purpose: 'inflight', identity: T }, async () => {
    sent(); await hold; return { response: { finished: true } };
  });
  await started;
  try {
    await setXCollection({ enabled: false }, T);
    await assert.rejects(paidRequest({ service: 'x_api', purpose: 'after-off', identity: T }, async () => { throw Error('must not call'); }), XCollectionPausedError);
  } finally { release(); }
  assert.deepEqual((await request).response, { finished: true });
});

test("toggle endpoint requires an admin, CSRF and a literal boolean", async () => {
  config.adminPassword = 'local-x-control-password';
  const login = await passwordLogin(config.adminPassword, '/admin', `x-control-${T}`);
  const cookie = `${SESSION_COOKIE}=${login.token}`;
  const app = Fastify({ logger: false }); registerAdminAuth(app); registerAdmin(app);
  try {
    const url = '/api/admin/x-collection';
    assert.equal((await app.inject({ method: 'POST', url, payload: { enabled: true } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url, headers: { cookie }, payload: { enabled: true } })).statusCode, 403);
    const me = (await app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } })).json();
    const headers = { cookie, 'x-csrf-token': me.csrf };
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { enabled: 'false' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { enabled: false, extra: true } })).statusCode, 400);
    assert.equal((await xCollectionState()).enabled, false);
    const closed = await app.inject({ method: 'POST', url, headers, payload: { enabled: false } });
    assert.equal(closed.statusCode, 200); assert.equal(closed.json().enabled, false);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  } finally { await app.close(); }
});

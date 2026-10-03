'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const SOURCE_ROOT = path.resolve(__dirname, '..');
const VIRTUAL_ROOT = '/virtual/fpl-analytics-ingestion';
const NOW = Date.parse('2026-09-05T09:00:00Z');
const ADMIN_COOKIE = 'fpl_admin_session';
const OWNER_COOKIE = 'fpl_analytics_internal';
const TEST_SECRET = 'test-only-admin-session-secret';
const TEST_PASSWORD = 'test-only-password';

// The complete server and its relative modules run against an in-memory fs.
// No port is opened, no production/local config is read, and fetch is denied.
function harness() {
  const files = new Map();
  const directories = new Set(['/virtual', VIRTUAL_ROOT]);
  const modules = new Map();
  let requestHandler;
  let networkCalls = 0;
  const checkedPath = (input) => {
    const resolved = path.resolve(String(input));
    assert.ok(resolved === VIRTUAL_ROOT || resolved.startsWith(`${VIRTUAL_ROOT}/`), 'test fs cannot touch real workspace files');
    return resolved;
  };
  const put = (input, value) => {
    const target = checkedPath(input);
    files.set(target, Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value)));
    let parent = path.dirname(target);
    while (parent.startsWith(VIRTUAL_ROOT)) { directories.add(parent); parent = path.dirname(parent); }
  };
  const unavailable = (file) => Object.assign(new Error(`Virtual file unavailable: ${file}`), { code: 'ENOENT' });
  const virtualFs = {
    existsSync(input) { const target = checkedPath(input); return files.has(target) || directories.has(target); },
    readFileSync(input, encoding) {
      const target = checkedPath(input);
      if (!files.has(target)) throw unavailable(target);
      return encoding ? files.get(target).toString(typeof encoding === 'string' ? encoding : encoding.encoding) : Buffer.from(files.get(target));
    },
    writeFileSync: put,
    mkdirSync(input) { directories.add(checkedPath(input)); },
    renameSync(from, to) { const old = checkedPath(from); const value = files.get(old); if (!value) throw unavailable(old); put(to, value); files.delete(old); },
    unlinkSync(input) { files.delete(checkedPath(input)); },
    appendFile(input, value, options, callback) {
      const target = checkedPath(input);
      put(target, Buffer.concat([files.get(target) || Buffer.alloc(0), Buffer.from(value)]));
      if (typeof options === 'function') options(null); else callback?.(null);
    },
    statSync(input) {
      const target = checkedPath(input);
      if (!files.has(target) && !directories.has(target)) throw unavailable(target);
      return { size: files.get(target)?.length || 0, mtime: new Date(NOW), isDirectory: () => directories.has(target), isFile: () => files.has(target) };
    },
    readdirSync(input) {
      const target = checkedPath(input);
      if (!directories.has(target)) throw unavailable(target);
      return [...new Set([...files.keys(), ...directories].filter((item) => path.dirname(item) === target).map((item) => path.basename(item)))];
    },
  };
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const mockHttp = {
    createServer(handler) {
      requestHandler = handler;
      return { listen() { throw new Error('Analytics tests must never open a port'); } };
    },
  };
  const context = vm.createContext({
    Buffer, URL, URLSearchParams, AbortController, AbortSignal, Date: FrozenDate,
    process: { env: {}, exit() { throw new Error('Unexpected process exit'); } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, clearInterval,
    setInterval() { throw new Error('Analytics tests must never start a scheduler'); },
    fetch(url) {
      if (url === 'https://fantasy.premierleague.com/api/fixtures/') return Promise.resolve({ ok: false, status: 503 });
      networkCalls++; throw new Error('External network is forbidden in analytics ingestion tests');
    },
  });
  function load(relative) {
    const name = relative.replace(/^\.\//, '').replace(/\.js$/, '') + '.js';
    if (modules.has(name)) return modules.get(name).exports;
    assert.ok(!name.includes('..') && !path.isAbsolute(name), 'only project code can be loaded');
    const module = { exports: {} };
    modules.set(name, module);
    const controlledRequire = (requested) => {
      if (requested === 'fs' || requested === 'node:fs') return virtualFs;
      if (requested === 'http' || requested === 'node:http') return mockHttp;
      if (requested.startsWith('./')) return load(requested);
      return require(requested);
    };
    controlledRequire.main = {};
    const code = fs.readFileSync(path.join(SOURCE_ROOT, name), 'utf8');
    const wrapper = vm.runInContext(`(function(require,module,exports,__dirname,__filename){${code}\n})`, context, { filename: name });
    wrapper(controlledRequire, module, module.exports, VIRTUAL_ROOT, path.join(VIRTUAL_ROOT, name));
    return module.exports;
  }
  put(path.join(VIRTUAL_ROOT, 'config.json'), JSON.stringify({
    leagueId: 47275, port: 9090, refreshMinutes: 15,
    adminPassword: TEST_PASSWORD, adminSessionSecret: TEST_SECRET, analyticsSalt: 'test-only-analytics-salt',
  }));
  const snapshot = (leagueId) => ({
    meta: { leagueId, leagueName: `Test league ${leagueId}`, snapshotSchema: require('../live-scoring').SNAPSHOT_SCHEMA, reportGw: 3,
      reportLive: false, weeklyPolicyVersion: 1, updated: new Date(NOW).toISOString() },
    funRankings: {version:1,rounds:[]},
    managers: [{ entryId: 11, entryName: 'Test manager' }], players: [], events: [], matchDetails: [],
  });
  put(path.join(VIRTUAL_ROOT, 'data/snapshot.json'), JSON.stringify(snapshot(47275)));
  put(path.join(VIRTUAL_ROOT, 'data/leagues/777.json'), JSON.stringify(snapshot(777)));
  const api = load('server');
  async function request(url, { method = 'GET', body, cookie, headers = {} } = {}) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    req.url = url;
    req.method = method;
    req.headers = {
      host: 'fpl.test', origin: 'https://fpl.test',
      'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36',
      ...(cookie ? { cookie } : {}), ...headers,
    };
    req.socket = { remoteAddress: '203.0.113.10' };
    const result = { status: null, headers: {}, text: '', body: null };
    const res = {
      setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
      getHeader(name) { return result.headers[name.toLowerCase()]; },
      writeHead(status, values = {}) {
        result.status = status;
        for (const [name, value] of Object.entries(values)) result.headers[name.toLowerCase()] = value;
      },
      end(value = '') { result.text += String(value); try { result.body = JSON.parse(result.text); } catch {} },
    };
    await requestHandler(req, res);
    assert.equal(networkCalls, 0, 'test route must not fetch official or external sources');
    assert.notEqual(result.status, null, 'HTTP handler must produce a response');
    return result;
  }
  return {
    api, request,
    putHistory: value => put(path.join(VIRTUAL_ROOT, 'data/analytics/league-history-v1.json'), JSON.stringify(value)),
    events: () => [...files].filter(([name]) => /\/\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .flatMap(([, value]) => value.toString().trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))),
    async loadLeague(id = 47275) {
      const result = await request(`/api/league/${id}`);
      assert.equal(result.status, 200);
    },
  };
}

function legacyAdminCookie() {
  const payload = Buffer.from(JSON.stringify({iat: NOW - 1000, exp: NOW + 86400000, nonce: 'test-legacy-session'})).toString('base64url');
  const signature = crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('base64url');
  return `${ADMIN_COOKIE}=${payload}.${signature}`;
}

test('server merges the separate historical file without fabricating PV and still gates admin access', async () => {
  const h = harness();
  h.api.buildAnalyticsReport(30); // establishes the immutable collector cutoff
  h.putHistory({ version: 1, cutoff: NOW, internalVisitorIds: [], events: [{
    type: 'league_use', source: 'access-log-backfill', ts: NOW - 1000,
    leagueId: 555, vid: 'a'.repeat(20), backfillId: 'b'.repeat(64), leagueName: 'Historical league',
  }] });
  assert.equal((await h.request('/api/admin/analytics')).status, 401);
  const response = await h.request('/api/admin/analytics', { cookie: legacyAdminCookie() });
  assert.equal(response.status, 200);
  assert.equal(response.body.leagueUsage.total, 1);
  assert.equal(response.body.leagueUsage.historical.opens, 1);
  assert.equal(response.body.summary.pageviews, 0);
  assert.equal(response.body.today.visitors, 0);
  assert.equal(h.events().length, 0);
});

test('server rejects corrupt or post-collector backfill without modifying the original event log', async () => {
  const h = harness();
  h.api.buildAnalyticsReport(30);
  h.putHistory({ version: 1, cutoff: NOW, internalVisitorIds: [], events: [{
    type: 'pageview', source: 'access-log-backfill', ts: NOW + 1,
    leagueId: 555, vid: 'a'.repeat(20), backfillId: 'b'.repeat(64),
  }] });
  assert.throws(() => h.api.buildAnalyticsReport(30), /Invalid historical league event/);
  assert.equal(h.events().length, 0);
});
const setCookies = (response) => Array.isArray(response.headers['set-cookie'])
  ? response.headers['set-cookie'] : response.headers['set-cookie'] ? [response.headers['set-cookie']] : [];
const cookieFrom = (response, name) => setCookies(response).find((value) => value.startsWith(`${name}=`))?.split(';')[0];
const event = (type, extra = {}) => ({type, sid: 'test-session', path: '/', tab: 'weekly', screenWidth: 1280, ...extra});
const postEvent = (h, body, extra = {}) => h.request('/api/analytics/event', {method:'POST', body, ...extra});

test('admin analytics stays protected, and a forged exclusion marker never authenticates an admin', async () => {
  const h = harness();
  assert.equal((await h.request('/api/admin/analytics')).status, 401);
  const forged = `${OWNER_COOKIE}=not-a-signed-token`;
  assert.equal((await h.request('/api/admin/analytics', {cookie:forged})).status, 401);
  assert.equal((await h.request('/api/admin/session', {cookie:forged})).body.authenticated, false);
});

test('legacy admin session tokens still authenticate and session/report reads mark the browser as internal', async () => {
  const h = harness();
  const cookie = legacyAdminCookie();
  const session = await h.request('/api/admin/session', {cookie});
  assert.equal(session.body.authenticated, true);
  assert.ok(cookieFrom(session, OWNER_COOKIE));
  const report = await h.request('/api/admin/analytics?days=7', {cookie});
  assert.equal(report.status, 200);
  assert.ok(cookieFrom(report, OWNER_COOKIE));
});

test('successful login issues separate admin and exclusion cookies, but bad login does neither', async () => {
  const h = harness();
  const failed = await h.request('/api/admin/login', {method:'POST', body:{password:'wrong-test-password'}});
  assert.equal(failed.status, 401);
  assert.equal(setCookies(failed).length, 0);
  const response = await h.request('/api/admin/login', {method:'POST', body:{password:TEST_PASSWORD}});
  assert.equal(response.status, 200);
  const admin = cookieFrom(response, ADMIN_COOKIE);
  const owner = cookieFrom(response, OWNER_COOKIE);
  assert.ok(admin);
  assert.ok(owner);
  assert.notEqual(admin.split('=')[1], owner.split('=')[1]);
  assert.ok(setCookies(response).every((value) => /HttpOnly/.test(value) && /Secure/.test(value)));
});

test('a genuine owner marker cannot be substituted for an admin credential or used to read admin reports', async () => {
  const h = harness();
  const response = await h.request('/api/admin/session', {cookie:legacyAdminCookie()});
  const owner = cookieFrom(response, OWNER_COOKIE);
  assert.ok(owner);
  assert.equal((await h.request('/api/admin/analytics', {cookie:owner})).status, 401);
  assert.equal((await h.request('/api/admin/session', {cookie:owner})).body.authenticated, false);
  const wrongPurpose = owner.replace(`${OWNER_COOKIE}=`, `${ADMIN_COOKIE}=`);
  assert.equal((await h.request('/api/admin/analytics', {cookie:wrongPurpose})).status, 401);
});

test('logout removes admin access without clearing the long-lived traffic exclusion', async () => {
  const h = harness();
  const login = await h.request('/api/admin/login', {method:'POST', body:{password:TEST_PASSWORD}});
  const owner = cookieFrom(login, OWNER_COOKIE);
  const admin = cookieFrom(login, ADMIN_COOKIE);
  const logout = await h.request('/api/admin/logout', {method:'POST', cookie:`${admin}; ${owner}`});
  assert.equal(logout.status, 200);
  assert.ok(setCookies(logout).some((value) => value.startsWith(`${ADMIN_COOKIE}=`) && /Max-Age=0/.test(value)));
  assert.ok(!setCookies(logout).some((value) => value.startsWith(`${OWNER_COOKIE}=`) && /Max-Age=0/.test(value)));
  assert.equal((await postEvent(h, event('pageview'), {cookie:owner})).status, 204);
  assert.equal(h.events().at(-1).internal, true);
});

test('client-supplied internal flags are ignored in both directions', async () => {
  const external = harness();
  assert.equal((await postEvent(external, event('pageview', {internal:true, admin:true, isAdmin:true}))).status, 204);
  assert.equal(external.events()[0].internal, false);
  const h = harness();
  assert.equal((await postEvent(h, event('pageview', {internal:false}), {cookie:legacyAdminCookie()})).status, 204);
  assert.equal(h.events()[0].internal, true);
});

test('invalid event types are rejected, not silently converted into pageviews', async () => {
  const h = harness();
  for (const body of [{}, {type:'nonsense'}, {type:'admin'}, null, [], {type:123}]) {
    assert.equal((await postEvent(h, body)).status, 400);
  }
  assert.deepEqual(h.events(), []);
});

test('unverified leagues cannot produce league-use statistics merely by posting an ID or URL', async () => {
  const h = harness();
  for (const leagueId of [999999, -1, 0, '1e3', true, null]) {
    assert.equal((await postEvent(h, event('league_use', {leagueId, path:'/?league=47275'}))).status, 400);
  }
  assert.deepEqual(h.events(), []);
});

test('a configured league or on-disk snapshot alone cannot bypass successful cache validation', async () => {
  const h = harness();
  assert.equal((await postEvent(h, event('league_use', {leagueId:47275}))).status, 400);
  assert.equal((await postEvent(h, event('league_use', {leagueId:777}))).status, 400);
  assert.deepEqual(h.events(), []);
  await h.loadLeague(777);
  assert.equal((await postEvent(h, event('league_use', {leagueId:777}))).status, 204);
});

test('validated cached league_use is a separate signal and does not double count pageviews', async () => {
  const h = harness();
  await h.loadLeague();
  assert.equal((await postEvent(h, event('pageview', {leagueId:47275}))).status, 204);
  assert.equal((await postEvent(h, event('league_use', {leagueId:47275, leagueName:'untrusted fake name'}))).status, 204);
  assert.equal(h.events().filter((item) => item.type === 'pageview').length, 1);
  const use = h.events().find((item) => item.type === 'league_use');
  assert.equal(use.leagueId, 47275);
  assert.equal(use.leagueName, 'Test league 47275');
  assert.equal(use.internal, false);
  assert.equal(h.api.buildAnalyticsReport(7).summary.pageviews, 1);
});

test('default and nondefault validated caches both supply trusted league identity', async () => {
  const h = harness();
  await h.loadLeague(47275);
  await h.loadLeague(777);
  for (const leagueId of [47275,777]) assert.equal((await postEvent(h, event('league_use', {leagueId}))).status, 204);
  assert.deepEqual(h.events().map((item) => [item.type,item.leagueId]), [['league_use',47275],['league_use',777]]);
  assert.equal(h.api.buildAnalyticsReport(7).summary.pageviews, 0);
});

test('logging in remembers the anonymous browser and excludes earlier matching traffic without exposing identities', async () => {
  const h = harness();
  await postEvent(h, event('pageview'));
  assert.equal(h.api.buildAnalyticsReport(7).summary.pageviews, 1);
  await h.request('/api/admin/login', {method:'POST', body:{password:TEST_PASSWORD}});
  assert.equal(h.api.buildAnalyticsReport(7).summary.pageviews, 0);
  await postEvent(h, event('pageview', {sid:'external-session'}), {headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0) Firefox/130.0'}});
  const report = h.api.buildAnalyticsReport(7);
  assert.equal(report.summary.pageviews, 1);
  assert.equal(JSON.stringify(report).includes(h.events()[0].vid), false, 'full anonymous identifiers are not exported by the report');
});

test('the signed marker survives IP/user-agent changes and remembers the new anonymous identity', async () => {
  const h = harness();
  const login = await h.request('/api/admin/login', {method:'POST', body:{password:TEST_PASSWORD}});
  const owner = cookieFrom(login, OWNER_COOKIE);
  const moved = {'x-forwarded-for':'203.0.113.25', 'user-agent':'Mozilla/5.0 (iPhone) Mobile Safari/605.1'};
  await postEvent(h, event('pageview', {sid:'new-device-session'}), {headers:moved});
  assert.equal(h.api.buildAnalyticsReport(7).summary.pageviews, 1, 'unknown changed identity is not guessed to be the owner');
  await postEvent(h, event('engagement', {sid:'new-device-session', duration:30}), {cookie:owner, headers:moved});
  assert.equal(h.events().at(-1).internal, true);
  const report = h.api.buildAnalyticsReport(7);
  assert.equal(report.summary.pageviews, 0, 'a valid marker supplies evidence to exclude this identity retroactively');
  assert.equal(report.exclusions.knownVisitors, 2);
});

test('tampering with an exclusion signature cannot hide another visitor traffic', async () => {
  const issuer = harness();
  const response = await issuer.request('/api/admin/session', {cookie:legacyAdminCookie()});
  const owner = cookieFrom(response, OWNER_COOKIE);
  const last = owner.at(-1);
  const invalid = owner.slice(0,-1) + (last === 'A' ? 'B' : 'A');
  const h = harness();
  assert.equal((await postEvent(h, event('pageview'), {cookie:invalid})).status, 204);
  assert.equal(h.events()[0].internal, false);
  assert.equal(h.api.buildAnalyticsReport(7).summary.pageviews, 1);
});

test('owner league opens are removed from historical adoption while external opens still count once', async () => {
  const h = harness();
  await h.loadLeague();
  await h.loadLeague(777);
  await postEvent(h, event('pageview', {leagueId:47275}));
  await postEvent(h, event('league_use', {leagueId:47275}));
  assert.equal(h.api.buildAnalyticsReport(7).leagueUsage.total, 1);
  await h.request('/api/admin/session', {cookie:legacyAdminCookie()});
  const external = {headers:{'x-forwarded-for':'203.0.113.27'}};
  await postEvent(h, event('pageview', {leagueId:777, sid:'other-session'}), external);
  await postEvent(h, event('league_use', {leagueId:777, sid:'other-session'}), external);
  await postEvent(h, event('league_use', {leagueId:777, sid:'other-session'}), external);
  const report = h.api.buildAnalyticsReport(7);
  assert.equal(report.summary.pageviews, 1);
  assert.equal(report.leagueUsage.total, 1);
  assert.equal(report.leagueUsage.rows[0].leagueId, 777);
  assert.equal(report.leagueUsage.rows[0].opens, 2);
});

test('cross-origin ingestion is rejected without recording even a valid event', async () => {
  const h = harness();
  assert.equal((await postEvent(h, event('pageview'), {headers:{origin:'https://untrusted.test'}})).status, 403);
  assert.deepEqual(h.events(), []);
});

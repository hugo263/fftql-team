'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildAccessLogBackfill } = require('../analytics-backfill');

const BASE = Date.parse('2026-09-04T10:00:00+08:00');
const CUTOFF = Date.parse('2026-09-05T23:00:00+08:00');
const IP = '198.51.100.10';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const hashVisitor = value => crypto.createHmac('sha256', 'test-only-secret').update(value).digest('hex').slice(0, 20);
const id = (ip = IP, ua = UA) => hashVisitor(`${ip}|${ua}`);
function time(value, offset = 480) {
  const shifted = new Date(value + offset * 60_000);
  const pad = number => String(number).padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][shifted.getUTCMonth()];
  return `${pad(shifted.getUTCDate())}/${month}/${shifted.getUTCFullYear()}:${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} ${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
}
function log(target = '/?league=47275', { ts = BASE, method = 'GET', status = 200, ip = IP, ua = UA,
  offset = 480, date, bytes = 1024, referrer = '-', request = null } = {}) {
  return `${ip} - - [${date || time(ts, offset)}] "${request || `${method} ${target} HTTP/1.1`}" ${status} ${bytes} "${referrer}" "${ua}"`;
}
function build(logs, options = {}) {
  return buildAccessLogBackfill(logs, { cutoff: CUTOFF, defaultLeagueId: 47275, hashVisitor, ...options });
}
const pair = (league = 47275, extra = {}) => [log(`/?league=${league}`, extra), log(`/api/league/${league}`, { ...extra, ts: (extra.ts ?? BASE) + 1000 })];

test('a successful explicit league document plus its API produces one stable anonymous inferred event', () => {
  const result = build(pair());
  assert.equal(result.events.length, 1);
  assert.deepEqual(Object.keys(result.events[0]).sort(), ['backfillId', 'leagueId', 'source', 'ts', 'type', 'v', 'vid']);
  assert.equal(result.events[0].ts, BASE);
  assert.equal(result.events[0].leagueId, 47275);
  assert.equal(result.events[0].type, 'league_use');
  assert.equal(result.events[0].source, 'access-log-backfill');
  assert.equal(result.events[0].vid, id());
  assert.match(result.events[0].backfillId, /^[a-f0-9]{64}$/);
  assert.equal(result.diagnostics.approximate, true);
  assert.equal(result.diagnostics.confirmedOpens, 1);
  assert.match(result.diagnostics.limitation, /不是精确全量/);
});

test('default root and index documents require the default snapshot API', () => {
  for (const pathname of ['/', '/index.html', '/?utm_source=chat', '/index.html?x=y']) {
    const result = build([log(pathname), log('/api/snapshot?fresh=1', { ts: BASE + 1000 })], { defaultLeagueId: 17 });
    assert.equal(result.events.length, 1, pathname);
    assert.equal(result.events[0].leagueId, 17);
  }
  assert.equal(build([log('/'), log('/api/league/47275', { ts: BASE + 1000 })]).events.length, 0);
  assert.equal(build([log('/?league=47275'), log('/api/snapshot', { ts: BASE + 1000 })]).events.length, 0);
});

test('successful static/fallback probes, API-only traffic and wrong HTTP methods do not count as documents', () => {
  const probes = ['/style.css', '/favicon.png', '/robots.txt', '/admin', '/discover', '/.env', '/unknown', '/unknown/../', '//', '/index.html/'];
  for (const target of probes) {
    assert.equal(build([log(target), log('/api/snapshot', { ts: BASE + 1000 })]).events.length, 0, target);
  }
  assert.equal(build(log('/api/league/47275')).events.length, 0);
  assert.equal(build(pair(47275, { method: 'HEAD' })).events.length, 0);
  assert.equal(build(pair(47275, { method: 'POST' })).events.length, 0);
});

test('document 200 and 304 are allowed, but API must be 200', () => {
  for (const status of [200, 304]) assert.equal(build([log('/?league=47275', { status }), log('/api/league/47275', { ts: BASE + 1000 })]).events.length, 1);
  for (const status of [201, 301, 302, 400, 404, 500]) assert.equal(build([log('/?league=47275', { status }), log('/api/league/47275', { ts: BASE + 1000 })]).events.length, 0);
  for (const status of [201, 304, 400, 404, 500]) assert.equal(build([log(), log('/api/league/47275', { ts: BASE + 1000, status })]).events.length, 0);
});

test('invalid or ambiguous league query cannot fall back to the default league', () => {
  for (const query of ['league=', 'league=0', 'league=-1', 'league=x', 'league=1.5', 'league=1e3',
    'league=9007199254740992', 'league=12&league=12', 'league=12&league=13', 'league=%ZZ', 'league=+12']) {
    const result = build([log(`/?${query}`), log('/api/snapshot', { ts: BASE + 1000 }), log('/api/league/12', { ts: BASE + 2000 })]);
    assert.equal(result.events.length, 0, query);
    assert.equal(result.diagnostics.invalidLeagueDocuments, 1, query);
  }
});

test('encoded valid query ID and API query suffix preserve the matching league', () => {
  const result = build([log('/index.html?utm_source=test&league=%31%32'), log('/api/league/12?refresh=true', { ts: BASE + 1000 })]);
  assert.equal(result.events[0].leagueId, 12);
});

test('an API must follow the document within 120 seconds inclusive', () => {
  assert.equal(build([log(), log('/api/league/47275', { ts: BASE + 120_000 })]).events.length, 1);
  assert.equal(build([log(), log('/api/league/47275', { ts: BASE + 121_000 })]).events.length, 0);
  assert.equal(build([log(), log('/api/league/47275', { ts: BASE - 1000 })]).events.length, 0);
  // Combined logs have second precision; same-second browser document/API
  // records are accepted as an explicitly approximate sequence.
  assert.equal(build([log(), log('/api/league/47275')]).events.length, 1);
});

test('both document and API must be strictly before collector cutoff', () => {
  assert.equal(build([log('/?league=47275', { ts: CUTOFF - 2000 }), log('/api/league/47275', { ts: CUTOFF - 1000 })]).events.length, 1);
  assert.equal(build([log('/?league=47275', { ts: CUTOFF - 1000 }), log('/api/league/47275', { ts: CUTOFF })]).events.length, 0);
  assert.equal(build(pair(47275, { ts: CUTOFF })).events.length, 0);
});

test('polling APIs do not create additional opens after their sole document was consumed', () => {
  const lines = [log(), ...Array.from({ length: 20 }, (_, index) => log('/api/league/47275', { ts: BASE + (index + 1) * 1000 }))];
  const result = build(lines);
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.unmatchedApiRequests, 19);
});

test('one API proves only the newest eligible unconfirmed document', () => {
  const result = build([log(), log('/?league=47275', { ts: BASE + 2000 }), log('/api/league/47275', { ts: BASE + 3000 })]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].ts, BASE + 2000);
  assert.equal(result.diagnostics.unconfirmedDocuments, 1);
});

test('later polling cannot claim older documents left behind by the newest confirmed open', () => {
  const result = build([log(), log('/?league=47275', { ts: BASE + 2000 }),
    log('/api/league/47275', { ts: BASE + 3000 }), log('/api/league/47275', { ts: BASE + 63_000 })]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].ts, BASE + 2000);
  assert.equal(result.diagnostics.unconfirmedDocuments, 1);
  assert.equal(result.diagnostics.unmatchedApiRequests, 1);
});

test('a genuinely new document after a confirmed open can be matched again', () => {
  const result = build([...pair(), log('/?league=47275', { ts: BASE + 10_000 }),
    log('/api/league/47275', { ts: BASE + 11_000 })]);
  assert.equal(result.events.length, 2);
  assert.equal(new Set(result.events.map(event => event.backfillId)).size, 2);
});

test('matching is independent across several leagues and distinct anonymous identities', () => {
  const result = build([log('/?league=1'), log('/?league=2', { ts: BASE + 1000 }),
    log('/api/league/1', { ts: BASE + 2000 }), log('/api/league/2', { ts: BASE + 3000 })]);
  assert.deepEqual(result.events.map(event => event.leagueId), [1, 2]);
  assert.equal(build([log(), log('/api/league/47275', { ts: BASE + 1000, ip: '198.51.100.11' })]).events.length, 0);
  assert.equal(build([log(), log('/api/league/47275', { ts: BASE + 1000, ua: `${UA} Different` })]).events.length, 0);
});

test('known owner IDs are excluded and preserved as an anonymous union', () => {
  const known = id('198.51.100.50');
  const result = build(pair(), { excludedVisitorIds: [id(), known, known] });
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.internalVisitorIds, [id(), known].sort());
});

test('successful admin login after cutoff identifies and excludes that identity across the entire history', () => {
  const result = build([...pair(), log('/api/admin/login', { method: 'POST', status: 200, ts: CUTOFF + 10_000 }),
    ...pair(17, { ip: '198.51.100.50' })]);
  assert.deepEqual(result.events.map(event => event.leagueId), [17]);
  assert.deepEqual(result.internalVisitorIds, [id()]);
});

test('authenticated admin analytics GET identifies internal use, but failed or wrong-method requests do not', () => {
  assert.equal(build([...pair(), log('/api/admin/analytics?days=30', { ts: BASE + 10_000 })]).events.length, 0);
  for (const extra of [{ status: 401 }, { status: 403 }, { method: 'POST' }]) {
    assert.equal(build([...pair(), log('/api/admin/analytics', { ...extra, ts: BASE + 10_000 })]).events.length, 1);
  }
  assert.equal(build([...pair(), log('/api/admin/login', { method: 'POST', status: 401 })]).events.length, 1);
  assert.equal(build([...pair(), log('/api/admin/login', { method: 'GET', status: 200 })]).events.length, 1);
});

test('bots, missing UA and non-browser clients are excluded even when both requests returned 200', () => {
  for (const ua of ['', '-', 'curl/8.1.0', 'python-requests/2.31', 'Mozilla/5.0 Googlebot/2.1', 'Mozilla/5.0 HeadlessChrome/130',
    'Mozilla/5.0 bingpreview', 'Mozilla/5.0 Playwright']) {
    assert.equal(build(pair(47275, { ua })).events.length, 0, ua);
  }
});

test('overlapping logs deduplicate requests and retain stable IDs regardless of input ordering', () => {
  const lines = [...pair(), ...pair(12, { ts: BASE + 5000 })];
  const canonical = build(lines);
  const overlaps = build([lines.join('\n'), lines.slice(1).join('\r\n'), lines[0]]);
  assert.deepEqual(overlaps.events, canonical.events);
  assert.equal(overlaps.diagnostics.duplicateLines, 4);
  assert.deepEqual(build([...lines].reverse()).events, canonical.events);
  assert.deepEqual(build(lines.join('\n')).events, canonical.events);
});

test('full SHA256 backfill IDs remain idempotent when later polling logs are added', () => {
  const first = build(pair());
  const second = build([...pair(), log('/api/league/47275', { ts: BASE + 10_000 })]);
  assert.deepEqual(second.events, first.events);
  assert.equal(new Set([...first.events, ...second.events].map(event => event.backfillId)).size, 1);
});

test('timestamp parsing respects explicit log offsets rather than the local machine timezone', () => {
  for (const offset of [0, 480, -240, 330]) {
    const result = build(pair(47275, { offset }));
    assert.equal(result.events[0].ts, BASE);
  }
  const result = build([log('/?league=47275', { offset: -240 }), log('/api/league/47275', { ts: BASE + 1000, offset: 480 })]);
  assert.equal(result.events[0].ts, BASE);
});

test('invalid timestamps and malformed combined records are ignored, not treated as successful page opens', () => {
  const malformed = [log('/?league=47275', { date: '31/Feb/2026:10:00:00 +0800' }),
    log('/?league=47275', { date: '04/Sep/2026:25:00:00 +0800' }), log('/?league=47275', { date: '04/Sep/2026:10:00:00 +0860' }),
    log('/?league=47275', { ip: 'not-an-ip' }), 'partial line without quotes', log('/?league=47275', { request: '-' })];
  const result = build([...malformed, log('/api/league/47275', { ts: BASE + 1000 })]);
  assert.equal(result.events.length, 0);
  assert.equal(result.diagnostics.malformedLines, malformed.length);
});

test('escaped UA bytes are decoded before applying the same live hash function', () => {
  const originalUa = `${UA} Test"Value\\Mark`;
  const escapedUa = originalUa.replace(/"/g, '\\x22').replace(/\\Mark/g, '\\x5CMark');
  const result = build(pair(47275, { ua: escapedUa }));
  assert.equal(result.events[0].vid, id(IP, originalUa));
});

test('outputs and diagnostics never contain original IP, UA, raw paths or referrer/query tokens', () => {
  const logs = [log('/?league=47275&secret=DO_NOT_OUTPUT', { referrer: 'https://private.example/?token=PRIVATE_TOKEN' }),
    log('/api/league/47275?access_token=SECRET', { ts: BASE + 1000 })];
  const output = JSON.stringify(build(logs));
  for (const sensitive of [IP, UA, 'DO_NOT_OUTPUT', 'PRIVATE_TOKEN', 'private.example', 'access_token', '/api/league']) {
    assert.ok(!output.includes(sensitive), sensitive);
  }
});

test('empty logs provide explicit zero inference and do not manufacture a tracking date', () => {
  const result = build([]);
  assert.deepEqual(result.events, []);
  assert.equal(result.diagnostics.firstLogAt, null);
  assert.equal(result.diagnostics.firstConfirmedAt, null);
  assert.equal(result.diagnostics.documentsConsidered, 0);
});

test('invalid configuration fails closed and default crypto fallback remains stable', () => {
  assert.throws(() => build([], { cutoff: undefined }), TypeError);
  assert.throws(() => build([], { cutoff: NaN }), TypeError);
  assert.throws(() => build([], { defaultLeagueId: 'x' }), TypeError);
  assert.throws(() => build(pair(), { hashVisitor: () => 'raw unsafe identity' }), TypeError);
  const options = { cutoff: CUTOFF, defaultLeagueId: 47275 };
  assert.deepEqual(buildAccessLogBackfill(pair(), options).events, buildAccessLogBackfill(pair(), options).events);
});

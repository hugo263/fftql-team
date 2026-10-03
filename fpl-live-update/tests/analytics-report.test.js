'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalyticsReport } = require('../analytics-report');

const ts = value => Date.parse(value);
const NOW = ts('2026-09-05T12:00:00+08:00');
const DAY = 86_400_000;
const TODAY = ts('2026-09-05T00:00:00+08:00');
const view = (time = NOW, extra = {}) => ({ ts: time, type: 'pageview', vid: 'visitor-external', sid: 'session-a',
  tab: 'weekly', referrer: '直接访问', device: '手机', browser: 'Safari', os: 'iOS', ...extra });
const use = (id, time = NOW, extra = {}) => view(time, { type: 'league_use', leagueId: id, leagueName: `League ${id}`, ...extra });
const report = (events = [], options = {}) => buildAnalyticsReport(events, { now: NOW, ...options });

test('empty report keeps existing fields, complete zero trend and unknown tracking start without invented history', () => {
  const result = report();
  for (const field of ['ok', 'generatedAt', 'days', 'range', 'trackingSince', 'summary', 'previous', 'trend',
    'modules', 'sources', 'devices', 'browsers', 'systems', 'hourly', 'recent', 'filteredBots']) assert.ok(field in result, field);
  assert.deepEqual(result.summary, { pageviews: 0, visitors: 0, sessions: 0, avgDuration: 0, bounceRate: 0, activeVisitors: 0 });
  assert.equal(result.trackingSince, null);
  assert.equal(result.leagueUsage.trackingSince, null);
  assert.deepEqual(result.leagueUsage.rows, []);
  assert.equal(result.leagueUsage.total, 0);
  assert.equal(result.leagueUsage.legacyPageviews, 0);
  assert.equal(result.trend.length, 30);
  assert.equal(result.hourly.length, 24);
  assert.equal(result.trend.reduce((sum, day) => sum + day.pageviews, 0), 0);
});

test('last N Shanghai calendar days include today and previous N complete days are adjacent and disjoint', () => {
  const start = TODAY - 2 * DAY;
  const previousStart = start - 3 * DAY;
  const result = report([
    view(previousStart - 1), view(previousStart), view(start - 1), view(start), view(NOW), view(NOW + 1),
  ], { days: 3 });
  assert.equal(result.range.start, start);
  assert.equal(result.range.end, NOW);
  assert.equal(result.range.previousStart, previousStart);
  assert.equal(result.range.previousEnd, start);
  assert.equal(result.range.previousEndInclusive, false);
  assert.equal(result.summary.pageviews, 2);
  assert.equal(result.previous.pageviews, 2);
  assert.deepEqual(result.trend.map(row => [row.date, row.pageviews]), [['2026-09-03', 1], ['2026-09-04', 0], ['2026-09-05', 1]]);
});

test('today includes midnight and now, excludes future events and does not depend on the selected range', () => {
  const events = [view(TODAY - 1), view(TODAY), view(NOW), view(NOW + 1), view(TODAY + DAY)];
  for (const days of [1, 7, 30, 90]) {
    const result = report(events, { days });
    assert.deepEqual(result.today, { date: '2026-09-05', start: TODAY, end: NOW, pageviews: 2, visitors: 1, sessions: 1 });
  }
});

test('crossing Shanghai midnight rolls calendar dates independently of UTC date and host timezone', () => {
  const now = ts('2026-09-06T00:00:00+08:00');
  const result = buildAnalyticsReport([view(now - 1), view(now)], { now, days: 1 });
  assert.equal(result.today.date, '2026-09-06');
  assert.equal(result.today.start, now);
  assert.equal(result.summary.pageviews, 1);
  assert.equal(result.previous.pageviews, 1);
  assert.equal(result.hourly[0].value, 1);
});

test('daily PV and hourly totals always reconcile with the summary across a UTC/Shanghai boundary', () => {
  const events = [];
  for (let hour = -160; hour <= 3; hour++) events.push(view(NOW + hour * 3_600_000, { vid: `v${Math.abs(hour) % 8}`, sid: `s${Math.abs(hour) % 3}` }));
  const result = report(events, { days: 7 });
  assert.equal(result.trend.reduce((sum, row) => sum + row.pageviews, 0), result.summary.pageviews);
  assert.equal(result.hourly.reduce((sum, row) => sum + row.value, 0), result.summary.pageviews);
  assert.equal(result.trend.at(-1).pageviews, result.today.pageviews);
});

test('today visitors and sessions come only from pageviews, not heartbeat/module/league events', () => {
  const result = report([
    view(), view(NOW - 10, { type: 'engagement', vid: 'heartbeat-only', sid: 'hb', duration: 30 }),
    view(NOW - 11, { type: 'tab_view', vid: 'module-only', sid: 'tab' }), use(12, NOW - 12, { vid: 'league-only', sid: 'league' }),
  ]);
  assert.equal(result.today.visitors, 1);
  assert.equal(result.today.sessions, 1);
  assert.equal(result.summary.visitors, 1);
  assert.equal(result.summary.sessions, 1);
  assert.equal(result.summary.activeVisitors, 4); // activity is intentionally a different metric
});

test('session IDs cannot collide across visitors and delimiter-like IDs remain distinct', () => {
  const result = report([
    view(NOW, { vid: 'visitor-a', sid: 'same' }), view(NOW, { vid: 'visitor-b', sid: 'same' }),
    view(NOW, { vid: 'a:b', sid: 'c' }), view(NOW, { vid: 'a', sid: 'b:c' }),
  ]);
  assert.equal(result.summary.sessions, 4);
  assert.equal(result.today.sessions, 4);
  assert.equal(result.trend.at(-1).sessions, 4);
});

test('session engagement sums only within the matching visible session and computes bounce/average correctly', () => {
  const result = report([
    view(NOW - 40, { vid: 'a', sid: 'same' }),
    view(NOW - 30, { vid: 'a', sid: 'same', type: 'engagement', duration: 8 }),
    view(NOW - 20, { vid: 'a', sid: 'same', type: 'engagement', duration: 12 }),
    view(NOW - 10, { vid: 'b', sid: 'same' }),
    view(NOW - 5, { vid: 'orphan', sid: 'same', type: 'engagement', duration: 1000 }),
  ]);
  assert.equal(result.summary.sessions, 2);
  assert.equal(result.summary.avgDuration, 10);
  assert.equal(result.summary.bounceRate, 50);
});

test('bots, explicitly internal events and retrospectively excluded visitors disappear from every metric', () => {
  const external = [view(), use(12), view(NOW, { type: 'engagement', duration: 20 })];
  const events = [...external];
  for (const extra of [{ bot: true, vid: 'robot' }, { internal: true, vid: 'marked-admin' }, { vid: 'known-admin' }]) {
    events.push(view(NOW - 1, extra), use(99, NOW - 1, extra), view(NOW - 1, { ...extra, type: 'tab_view', tab: 'trades' }),
      view(NOW - 1, { ...extra, type: 'engagement', duration: 100 }));
  }
  const result = report(events, { excludedVisitorIds: ['known-admin'], exclusionsSince: TODAY });
  assert.equal(result.summary.pageviews, 1);
  assert.equal(result.summary.visitors, 1);
  assert.equal(result.summary.sessions, 1);
  assert.equal(result.summary.avgDuration, 20);
  assert.equal(result.summary.activeVisitors, 1);
  assert.equal(result.today.pageviews, 1);
  assert.equal(result.trend.at(-1).pageviews, 1);
  assert.equal(result.recent.length, 1);
  for (const rows of [result.sources, result.devices, result.browsers, result.systems, result.modules]) {
    assert.equal(rows.reduce((sum, row) => sum + row.value, 0), 1);
  }
  assert.equal(result.leagueUsage.total, 1);
  assert.equal(result.leagueUsage.rows[0].leagueId, 12);
  assert.equal(result.filteredBots, 4);
  assert.deepEqual(result.exclusions, { since: TODAY, internalEvents: 8, internalPageviews: 2, knownVisitors: 1, affectedVisitors: 2 });
});

test('retrospective visitor exclusion applies to prior-window and all retained league history', () => {
  const old = NOW - 90 * DAY;
  const result = report([use(10, old, { vid: 'admin' }), view(TODAY - DAY, { vid: 'admin' }),
    view(TODAY - DAY, { vid: 'external' }), use(20, old, { vid: 'external' })],
  { days: 1, excludedVisitorIds: ['admin'] });
  assert.equal(result.previous.pageviews, 1);
  assert.equal(result.leagueUsage.total, 1);
  assert.equal(result.leagueUsage.rows[0].leagueId, 20);
  assert.equal(result.leagueUsage.period, 0);
});

test('leagues used only by the owner do not count, but the same league used by an external visitor counts', () => {
  const own = [use(47275, NOW - 10, { vid: 'owner' }), use(7, NOW - 9, { internal: true })];
  assert.equal(report(own, { excludedVisitorIds: ['owner'] }).leagueUsage.total, 0);
  const result = report([...own, use(47275, NOW - 8, { vid: 'external' })], { excludedVisitorIds: ['owner'] });
  assert.equal(result.leagueUsage.total, 1);
  assert.equal(result.leagueUsage.rows[0].opens, 1);
  assert.equal(result.leagueUsage.rows[0].visitors, 1);
});

test('league usage counts retained distinct IDs, independently scopes period/today and ranks by opens', () => {
  const old = NOW - 90 * DAY;
  const events = [use(1, old, { leagueName: 'Old' }), use(2, TODAY - DAY), use('2', TODAY + 1, { leagueName: 'Latest name' }),
    use(2, TODAY + 2, { vid: 'second-visitor' }), use(3, NOW), use(4, NOW + 1)];
  const result = report(events, { days: 7 });
  assert.equal(result.leagueUsage.total, 3);
  assert.equal(result.leagueUsage.period, 2);
  assert.equal(result.leagueUsage.today, 2);
  assert.deepEqual(result.leagueUsage.rows.map(row => row.leagueId), [2, 1, 3]);
  assert.deepEqual(result.leagueUsage.rows[0], { leagueId: 2, name: 'League 2', opens: 3, historicalOpens: 0, visitors: 2,
    firstSeen: TODAY - DAY, lastSeen: TODAY + 2 });
  assert.equal(report(events, { days: 1 }).leagueUsage.total, 3);
  assert.equal(report(events, { days: 1 }).leagueUsage.period, 2);
});

test('ordinary pageviews, API-poll lookalikes and invalid league IDs never fabricate confirmed league usage', () => {
  const invalid = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, false, '', '0', '03', '1e3', ' 3 ', {}, null, undefined];
  const events = [view(NOW, { leagueId: 47275 }), view(NOW, { type: 'engagement', leagueId: 22 }),
    view(NOW, { type: 'api_poll', leagueId: 33 }), ...invalid.map(id => use(id))];
  const result = report(events);
  assert.equal(result.leagueUsage.total, 0);
  assert.equal(result.leagueUsage.period, 0);
  assert.deepEqual(result.leagueUsage.rows, []);
  assert.equal(result.summary.pageviews, 1);
});

test('legacy unattributed pageviews remain a warning count, not an inferred count of leagues', () => {
  const events = [view(NOW - 200 * DAY), view(), view(NOW, { leagueId: null }), view(NOW, { leagueId: 5 }),
    view(NOW, { bot: true }), view(NOW, { vid: 'owner' }), view(NOW, { internal: true })];
  const result = report(events, { days: 1, excludedVisitorIds: ['owner'] });
  assert.equal(result.leagueUsage.legacyPageviews, 3);
  assert.equal(result.leagueUsage.total, 0);
  assert.equal(result.leagueUsage.trackingSince, null);
});

test('v2 initial pageviews without a verified league are not mislabeled as missing legacy instrumentation', () => {
  const result = report([view(NOW, { v: 1 }), view(NOW, { v: 2, leagueId: null }),
    view(NOW, { v: 2 }), view(NOW, { v: 2, leagueId: 12 }), use(12, NOW, { v: 2 })]);
  assert.equal(result.leagueUsage.legacyPageviews, 1);
  assert.equal(result.summary.pageviews, 4);
  assert.equal(result.leagueUsage.total, 1);
  assert.equal(result.leagueUsage.rows[0].opens, 1);
});

test('league rows cap at 100 without truncating the retained distinct total', () => {
  const result = report(Array.from({ length: 130 }, (_, index) => use(index + 1)));
  assert.equal(result.leagueUsage.total, 130);
  assert.equal(result.leagueUsage.rows.length, 100);
  assert.equal(result.leagueUsage.period, 130);
  assert.equal(result.leagueUsage.today, 130);
});

test('known collection start is preserved but no pre-existing traffic or league usage is manufactured', () => {
  const since = NOW - 200 * DAY;
  const result = report([view(), use(5)], { trackingSince: since, leagueTrackingSince: TODAY, exclusionsSince: TODAY });
  assert.equal(result.trackingSince, since);
  assert.equal(result.leagueUsage.trackingSince, TODAY);
  assert.equal(result.summary.pageviews, 1);
  assert.equal(result.previous.pageviews, 0);
  assert.equal(result.leagueUsage.total, 1);
  assert.equal(report([], { leagueTrackingSince: TODAY }).leagueUsage.trackingSince, TODAY);
  assert.equal(report([], { leagueTrackingSince: TODAY }).leagueUsage.total, 0);
});

test('invalid times and missing visitor/session IDs do not become fabricated dates or users', () => {
  const result = report([view(NaN), view(Infinity), view(-1), view('not-a-time'), null,
    view(NOW, { vid: null, sid: null }), view(NOW, { vid: 'has-visitor', sid: '' })]);
  assert.equal(result.summary.pageviews, 2);
  assert.equal(result.summary.visitors, 1);
  assert.equal(result.summary.sessions, 0);
  assert.equal(result.summary.avgDuration, 0);
  assert.equal(result.recent[1].visitor, '未知访客');
});

test('negative/non-numeric durations cannot corrupt averages and oversized durations use ingestion bounds', () => {
  const result = report([view(), ...[-5, NaN, Infinity, '20', 3600].map(duration => view(NOW, { type: 'engagement', duration }))]);
  assert.equal(result.summary.avgDuration, 1800);
  assert.equal(result.summary.bounceRate, 0);
});

test('recent and distribution views use the same filters, include new modules and are deterministically ordered', () => {
  const events = [view(NOW - 2, { tab: 'share' }), view(NOW - 1, { type: 'tab_view', tab: 'freeagents' }), view(NOW, { tab: 'standings' })];
  const result = report(events);
  assert.deepEqual(result.recent.map(row => row.module), ['积分榜', '自由球员', '阵容分享']);
  assert.deepEqual(new Set(result.modules.map(row => row.label)), new Set(['积分榜', '自由球员', '阵容分享']));
  assert.equal(result.sources[0].value, 2);
});

test('input order cannot change metric totals, timestamps or overwrite the source event objects', () => {
  const events = [use(5, NOW, { leagueName: 'Current' }), view(TODAY), use(5, TODAY, { leagueName: 'Earlier' })];
  const original = structuredClone(events);
  const result = report(events);
  assert.equal(result.leagueUsage.rows[0].name, 'Current');
  assert.equal(result.leagueUsage.rows[0].firstSeen, TODAY);
  assert.deepEqual(events, original);
  assert.deepEqual(report([...events].reverse()), result);
});

test('options reject nonsensical numeric windows instead of silently selecting another period', () => {
  for (const days of [0, -1, 1.5, NaN, Infinity, '7', 401]) assert.throws(() => report([], { days }), TypeError);
  for (const now of [NaN, Infinity, -1, '2026-09-05']) assert.throws(() => report([], { now }), TypeError);
});

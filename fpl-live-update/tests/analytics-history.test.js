'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHistory } = require('../analytics-history');
const { buildAnalyticsReport } = require('../analytics-report');
const cutoff = Date.parse('2026-09-05T15:22:43Z');
const event = (extra = {}) => ({ type: 'league_use', source: 'access-log-backfill',
  ts: cutoff - 86400000, vid: 'a'.repeat(20), leagueId: 123, backfillId: 'c'.repeat(64), ...extra });
const history = (events = [event()], extra = {}) => ({ version: 1, cutoff, events, internalVisitorIds: [], ...extra });
const report = (old, current = [], options = {}) => buildAnalyticsReport(current, {
  now: cutoff + 60000, leagueTrackingSince: cutoff, history: old, ...options,
});

test('historical league opens join distinct totals, not PV, UV, sessions or active visitors', () => {
  const current = [{ type: 'pageview', ts: cutoff + 1, vid: 'a'.repeat(20), sid: 's' },
    { type: 'league_use', ts: cutoff + 2, leagueId: 123, vid: 'a'.repeat(20) }];
  const before = report(null, current);
  const after = report(history(), current);
  for (const key of ['summary', 'previous', 'today', 'trend', 'hourly', 'recent', 'trackingSince']) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.equal(after.leagueUsage.total, 1);
  assert.equal(after.leagueUsage.opens, 2);
  assert.equal(after.leagueUsage.rows[0].visitors, 1);
  assert.equal(after.leagueUsage.rows[0].historicalOpens, 1);
  assert.equal(after.leagueUsage.historical.opens, 1);
  assert.equal(after.leagueUsage.trackingSince, cutoff - 86400000);
  assert.equal(after.leagueUsage.collectorSince, cutoff);
});

test('historical totals are independent of range and period/today retain correct boundaries', () => {
  const old = history([event({ ts: cutoff - 90 * 86400000 }),
    event({ ts: cutoff - 1, leagueId: 456, backfillId: 'd'.repeat(64) })]);
  for (const days of [1, 7, 30]) {
    const result = report(old, [], { days }).leagueUsage;
    assert.equal(result.total, 2);
    assert.equal(result.period, 1);
    assert.equal(result.today, 1);
    assert.equal(result.historical.leagues, 2);
  }
});

test('deduplicates historical event IDs and excludes retrospectively identified owner across both sources', () => {
  const old = history([event(), event()], { internalVisitorIds: ['b'.repeat(20)] });
  assert.equal(validateHistory(old, cutoff).events.length, 1);
  const current = [{ type: 'pageview', vid: 'b'.repeat(20), sid: 'owner', ts: cutoff + 1 }];
  const result = report(old, current, { excludedVisitorIds: ['a'.repeat(20)] });
  assert.equal(result.summary.pageviews, 0);
  assert.equal(result.leagueUsage.total, 0);
  assert.equal(result.exclusions.knownVisitors, 2);
});

test('rejects post-cutoff events, fabricated pageviews, invalid IDs and identities or mismatched imports', () => {
  for (const extra of [{ ts: cutoff }, { ts: cutoff + 1 }, { ts: -1 }, { ts: NaN },
    { type: 'pageview' }, { source: 'manual' }, { leagueId: 0 }, { leagueId: '123' },
    { vid: 'raw-ip' }, { backfillId: '' }]) {
    assert.throws(() => validateHistory(history([event(extra)]), cutoff));
  }
  assert.throws(() => validateHistory(history(), cutoff + 1));
  assert.throws(() => validateHistory(history([], { internalVisitorIds: ['raw-ip'] }), cutoff));
});

test('newly imported no-match history is distinguishable from no backfill and does not invent a start date', () => {
  const missing = report(null).leagueUsage;
  const imported = report(history([])).leagueUsage;
  assert.equal(missing.historical.imported, false);
  assert.equal(imported.historical.imported, true);
  assert.equal(imported.historical.since, null);
  assert.equal(imported.trackingSince, cutoff);
});

test('history never exposes arbitrary raw fields from imported artifacts', () => {
  const clean = validateHistory(history([event({ ip: 'sensitive', userAgent: 'sensitive' })]), cutoff);
  assert.equal(clean.events[0].ip, undefined);
  assert.equal(clean.events[0].userAgent, undefined);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarFromFixtures, createMatchdayCalendar, classifyDay } = require('../analytics-matchdays');
const { buildAnalyticsReport } = require('../analytics-report');
const rows = () => Array.from({ length: 380 }, (_, id) => ({ id: id + 1,
  kickoff_time: id < 190 ? '2026-09-04T17:30:00Z' : '2026-09-07T19:00:00Z' }));

test('matchdays use Beijing kickoff dates, not UTC or weekends', () => {
  const calendar = calendarFromFixtures(rows(), 100);
  assert.deepEqual(calendar.dates, ['2026-09-05', '2026-09-08']);
  assert.equal(classifyDay('2026-09-05', calendar), 'matchday');
  assert.equal(classifyDay('2026-09-06', calendar), 'nonMatchday');
  assert.equal(classifyDay('2026-09-08', calendar), 'matchday');
  assert.equal(classifyDay('2025-09-05', calendar), 'unknown');
  assert.equal(classifyDay('2026-09-06', null), 'unknown');
});
test('partial, duplicate, undated and corrupt calendar data cannot fabricate non-matchdays', () => {
  assert.throws(() => calendarFromFixtures(rows().slice(0, 10)), /Incomplete/);
  assert.throws(() => calendarFromFixtures(rows().map(r => ({ ...r, id: 1 }))), /Incomplete/);
  const fixtures = rows(); fixtures[0].kickoff_time = null;
  const calendar = calendarFromFixtures(fixtures);
  assert.equal(classifyDay('2026-09-06', calendar), 'unknown');
  assert.equal(classifyDay('2026-09-05', calendar), 'matchday');
});
test('calendar requests are deduplicated, cached and safely fail with retry backoff', async () => {
  let clock = 1000000, calls = 0, fail = false;
  const service = createMatchdayCalendar({ now: () => clock, fetchFixtures: async () => { calls++; if (fail) throw Error('offline'); return rows(); } });
  await Promise.all([service.get(), service.get()]); assert.equal(calls, 1);
  await service.get(); assert.equal(calls, 1);
  clock += 900001; fail = true;
  assert.equal((await service.get()).stale, true); assert.equal(calls, 2);
  await service.get(); assert.equal(calls, 2);
  clock += 60001; fail = false;
  assert.equal((await service.get()).stale, false); assert.equal(calls, 3);
  assert.equal(await createMatchdayCalendar({ fetchFixtures: async () => { throw Error('offline'); } }).get(), null);
});
test('hourly category splits reconcile with total PV and keep exclusions/Shanghai midnight', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const make = (ts, extra = {}) => ({ ts: Date.parse(ts), type: 'pageview', vid: 'a', sid: 'b', ...extra });
  const events = [make('2026-09-04T15:59:00Z'), make('2026-09-04T16:00:00Z'),
    make('2026-09-05T16:00:00Z'), make('2026-09-07T17:00:00Z'),
    make('2026-09-07T17:00:00Z', { bot: true }), make('2026-09-07T17:00:00Z', { internal: true }),
    make('2026-09-07T17:00:00Z', { type: 'tab_view' })];
  const result = buildAnalyticsReport(events, { now, days: 7, matchdayCalendar: calendarFromFixtures(rows()) });
  assert.equal(result.summary.pageviews, 4);
  assert.equal(result.hourly[0].matchday, 1); assert.equal(result.hourly[0].nonMatchday, 1);
  assert.equal(result.hourly[1].matchday, 1); assert.equal(result.hourly[23].unknown, 1);
  for (const hour of result.hourly) assert.equal(hour.matchday + hour.nonMatchday + hour.unknown, hour.value);
  assert.equal(Object.values(result.matchdayCalendar.dayCounts).reduce((a,b) => a+b), 7);
  const missing = buildAnalyticsReport(events, { now, days: 7 });
  assert.equal(missing.hourly.reduce((sum, row) => sum + row.unknown, 0), 4);
});

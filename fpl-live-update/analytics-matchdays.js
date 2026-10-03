'use strict';
const SOURCE = 'https://fantasy.premierleague.com/api/fixtures/';
const dateKey = ts => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);

function calendarFromFixtures(fixtures, now = Date.now()) {
  // A partial event response must never make the rest of the season non-matchdays.
  if (!Array.isArray(fixtures) || fixtures.length !== 380 || fixtures.some(f => !f || !Number.isSafeInteger(f.id) || f.id <= 0)
    || new Set(fixtures.map(f => f.id)).size !== fixtures.length) {
    throw new Error('Incomplete season fixture calendar');
  }
  const times = fixtures.filter(f => typeof f.kickoff_time === 'string')
    .map(f => Date.parse(f.kickoff_time)).filter(Number.isFinite);
  if (!times.length) throw new Error('No dated fixtures');
  const dates = [...new Set(times.map(dateKey))].sort();
  return { source: SOURCE, fetchedAt: now, start: dates[0], end: dates.at(-1), dates,
    // Undated/postponed matches are not assigned an invented day.
    undated: fixtures.length - times.length };
}

function createMatchdayCalendar({ fetchFixtures, now = Date.now }) {
  let cached = null, pending = null, retryAt = 0;
  const read = () => cached ? { ...cached, stale: now() - cached.fetchedAt >= 900000 } : null;
  async function get() {
    if (cached && now() - cached.fetchedAt < 900000) return read();
    if (pending) return pending;
    if (now() < retryAt) return read();
    pending = (async () => {
      try { cached = calendarFromFixtures(await fetchFixtures(SOURCE), now()); }
      catch { retryAt = now() + 60000; }
      finally { pending = null; }
      return read();
    })();
    return pending;
  }
  return { get };
}

function classifyDay(date, calendar) {
  if (!calendar || !Array.isArray(calendar.dates) || date < calendar.start || date > calendar.end) return 'unknown';
  if (calendar.dates.includes(date)) return 'matchday';
  // With unscheduled matches, absence of a date is not positive evidence.
  return calendar.undated ? 'unknown' : 'nonMatchday';
}
module.exports = { createMatchdayCalendar, calendarFromFixtures, classifyDay };

'use strict';

// Historical inference is kept separate from the original PV/UV event log.
// Only pre-collector league usage can be imported; never invent pageviews.
function validateHistory(value, cutoff) {
  if (!value || value.version !== 1 || value.cutoff !== cutoff
    || !Number.isFinite(cutoff) || cutoff <= 0 || !Array.isArray(value.events)
    || !Array.isArray(value.internalVisitorIds)) throw new Error('Invalid historical analytics file');
  const ids = value.internalVisitorIds;
  if (ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{20}$/.test(id))) throw new Error('Invalid historical visitor identity');
  const seen = new Set();
  const events = [];
  for (const event of value.events) {
    if (event.type !== 'league_use' || event.source !== 'access-log-backfill'
      || !Number.isFinite(event.ts) || event.ts < 0 || event.ts >= cutoff
      || !Number.isSafeInteger(event.leagueId) || event.leagueId <= 0
      || !/^[a-f0-9]{20}$/.test(event.vid || '')
      || !/^[a-f0-9]{64}$/.test(event.backfillId || '')) throw new Error('Invalid historical league event');
    if (seen.has(event.backfillId)) continue;
    seen.add(event.backfillId);
    events.push({ type: 'league_use', source: 'access-log-backfill', ts: event.ts,
      vid: event.vid, leagueId: event.leagueId, backfillId: event.backfillId,
      leagueName: typeof event.leagueName === 'string' ? event.leagueName.slice(0, 150) : '' });
  }
  events.sort((a, b) => a.ts - b.ts || a.backfillId.localeCompare(b.backfillId));
  return { ...value, events, internalVisitorIds: [...new Set(ids)] };
}

module.exports = { validateHistory };

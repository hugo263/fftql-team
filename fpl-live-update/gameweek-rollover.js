'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DAY_MS = 24 * 60 * 60_000;
const LEGACY_MATCH_WINDOW_MS = 3 * 60 * 60_000;
const finished = fixture => fixture.finished === true || fixture.finished_provisional === true;

// Display selection only. Never advance the Draft scoring/locked-lineup GW.
function displayGameweek(events, fixtures, completions = {}, now = Date.now()) {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  const begun = ordered.filter(e => Date.parse(e.deadline_time) <= now);
  const current = begun.at(-1) || ordered.find(e => e.is_current) || ordered[0];
  if (!current) return { weeklyPolicyVersion: 1, weeklyDefaultGw: 0 };
  const next = ordered.find(e => e.id > current.id);
  const matches = fixtures.filter(f => f.event === current.id);
  const saved = completions[current.id];
  const completion = matches.length && matches.every(finished) && Number.isFinite(saved?.finishedAt) ? saved : null;
  const switchAt = completion && next ? completion.finishedAt + DAY_MS : null;
  return {
    weeklyPolicyVersion: 1,
    weeklyDefaultGw: switchAt != null && now >= switchAt ? next.id : current.id,
    weeklySwitchAt: switchAt != null ? new Date(switchAt).toISOString() : null,
    nextWeeklyGw: next?.id || null,
    weeklyFinishedAt: completion ? new Date(completion.finishedAt).toISOString() : null,
    weeklyFinishBasis: completion?.basis || null,
  };
}

function createGameweekRollover({ cachePath } = {}) {
  let season = null, rounds = {};
  try {
    const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (saved.version === 1 && typeof saved.season === 'string' && saved.rounds && typeof saved.rounds === 'object') {
      season = saved.season;
      for (const [gw, entry] of Object.entries(saved.rounds)) {
        if (/^([1-9]|[12]\d|3[0-8])$/.test(gw) && typeof entry?.signature === 'string'
          && (Number.isFinite(entry.finishedAt) && ['observed', 'legacy-estimate'].includes(entry.basis)
            || entry.basis === 'pending' && Number.isFinite(entry.pendingAt))) rounds[gw] = entry;
      }
    }
  } catch { /* Missing independent display metadata never blocks official data. */ }
  function observe(events, fixtures, now = Date.now()) {
    const nextSeason = events.find(e => e.id === 1)?.deadline_time;
    if (!nextSeason) return displayGameweek(events, fixtures, {}, now);
    const before = JSON.stringify({ season, rounds });
    if (season !== nextSeason) { season = nextSeason; rounds = {}; }
    for (const gw of new Set(fixtures.map(f => f.event).filter(id => Number.isInteger(id) && id > 0 && id <= 38))) {
      const matches = fixtures.filter(f => f.event === gw);
      const signature = matches.map(f => `${f.id}:${f.kickoff_time}`).sort().join('|');
      if (!matches.every(finished)) {
        if (rounds[gw]?.basis !== 'pending' || rounds[gw].signature !== signature) {
          rounds[gw] = { signature, pendingAt: now, basis: 'pending' };
        }
        continue;
      }
      if (rounds[gw]?.signature === signature && Number.isFinite(rounds[gw].finishedAt) && rounds[gw].finishedAt <= now) continue;
      const kickoffs = matches.map(f => Date.parse(f.kickoff_time));
      const estimate = Math.max(...kickoffs) + LEGACY_MATCH_WINDOW_MS;
      // The official API has no final-whistle timestamp. For rounds completed
      // before collection began, only backfill once a conservative 3h match
      // window + 24h has elapsed AND every fixture is officially finished.
      // Thereafter persist the first observed full-round completion, not each
      // refresh time. Postponed/TBD/unfinished fixtures can never trigger this.
      const legacy = !rounds[gw] && kickoffs.every(Number.isFinite) && estimate + DAY_MS <= now;
      rounds[gw] = { signature, finishedAt: legacy ? estimate : now,
        basis: legacy ? 'legacy-estimate' : 'observed' };
    }
    if (cachePath && before !== JSON.stringify({ season, rounds })) {
      try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const temp = `${cachePath}.tmp-${process.pid}`;
        fs.writeFileSync(temp, JSON.stringify({ version: 1, season, rounds }));
        fs.renameSync(temp, cachePath);
      } catch (error) { console.warn('[rollover] display metadata persistence failed:', error.message); }
    }
    return displayGameweek(events, fixtures, rounds, now);
  }
  return { observe, state: (events, fixtures, now = Date.now()) => displayGameweek(events, fixtures, rounds, now) };
}

module.exports = { createGameweekRollover, displayGameweek, DAY_MS, LEGACY_MATCH_WINDOW_MS };

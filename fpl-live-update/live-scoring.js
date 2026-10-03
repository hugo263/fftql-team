'use strict';

// Calendar state, scoring and cache rules are kept pure so deadline transitions
// can be tested without calling the network or modifying production snapshots.
const LIVE_REFRESH_MS = 60_000;
const SNAPSHOT_SCHEMA = 7;

function deriveGameweekState(events, fixtures = [], now = Date.now()) {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  const begun = ordered.filter((event) => Date.parse(event.deadline_time || '') <= now);
  const currentEvent = begun.at(-1) || ordered.find((event) => event.is_current) || ordered[0];
  const currentGw = currentEvent?.id || 0;
  const gwStarted = begun.some((event) => event.id === currentGw);
  const currentFixtures = fixtures.filter((fixture) => fixture.event === currentGw);
  // Football full time and official score settlement are different milestones.
  const allFixturesFinished = currentFixtures.length > 0 && currentFixtures.every((fixture) => fixture.finished === true || fixture.finished_provisional === true);
  let lastFinishedGw = Math.max(0, ...ordered.filter((event) => event.finished).map((event) => event.id));
  if (gwStarted && allFixturesFinished) lastFinishedGw = Math.max(lastFinishedGw, currentGw);
  const gwFinished = currentGw > 0 && lastFinishedGw >= currentGw;
  const gwInProgress = gwStarted && !gwFinished;
  const reportGw = gwStarted ? currentGw : lastFinishedGw;
  return {
    currentGw, lastFinishedGw, reportGw, gwStarted, gwFinished, gwInProgress,
    reportLive: gwInProgress,
    fixturesStarted: currentFixtures.some((fixture) => fixture.started || fixture.finished),
    reportFinalizing: gwFinished && !(currentEvent?.finished && currentEvent?.data_checked !== false),
    upcomingGw: Math.max(1, lastFinishedGw + 1),
  };
}

function snapshotTtlMs(snapshot, normalTtlMs, now = Date.now()) {
  if (snapshot?.meta?.snapshotSchema !== SNAPSHOT_SCHEMA) return 0;
  if (snapshot.meta.reportLive || snapshot.meta.reportFinalizing) {
    // Precomputed lineups and the score table share one source-age window.
    // Time spent building a report must not make its details stale while the
    // containing snapshot still appears fresh for another sixty seconds.
    const sourceExpiry = Date.parse(snapshot.meta.reportSourceExpiresAt || '');
    const built = Date.parse(snapshot.meta.updated || '');
    return Number.isFinite(sourceExpiry) && Number.isFinite(built)
      ? Math.max(0, Math.min(LIVE_REFRESH_MS, sourceExpiry - built)) : LIVE_REFRESH_MS;
  }
  // A pre-deadline snapshot must expire exactly at the next deadline, even if
  // the normal fifteen-minute cache would otherwise keep it alive.
  const built = Date.parse(snapshot.meta.updated || '');
  const nextDeadline = Math.min(Infinity, ...(snapshot.events || [])
    .map((event) => Date.parse(event.deadline || event.deadline_time || ''))
    .filter((deadline) => Number.isFinite(deadline) && deadline > built));
  if (nextDeadline <= now) return 0;
  return Math.min(normalTtlMs, nextDeadline - built);
}

function isSnapshotFresh(snapshot, normalTtlMs, now = Date.now()) {
  const age = now - Date.parse(snapshot?.meta?.updated || '');
  return age >= 0 && age < snapshotTtlMs(snapshot, normalTtlMs, now);
}

function scoreLockedPicks(payload, points, resolvedPositions = null) {
  if (!payload || !Array.isArray(payload.picks) || !payload.picks.length) return null;
  // Draft reports multiplier:1 on ALL 15 picks, including substitutes. There
  // is no captain: select the actual XI, then honor the API's substitutions.
  const active = resolvedPositions instanceof Map
    ? new Set([...resolvedPositions].filter(([, position]) => position <= 11).map(([element]) => element))
    : new Set(payload.picks.filter((pick) => pick.position <= 11).map((pick) => pick.element));
  for (const sub of resolvedPositions instanceof Map ? [] : payload.subs || payload.automatic_subs || []) {
    const out = sub.element_out;
    const incoming = sub.element_in;
    if (out != null && incoming != null && active.has(out)) {
      active.delete(out);
      active.add(incoming);
    }
  }
  if ([...active].some((element) => !points.has(element))) return null;
  return [...active].reduce((total, element) => total + Number(points.get(element) || 0), 0);
}

function applyLiveMatchScores(matches, reportGw, scoresByLeagueEntry, state) {
  return matches.map((match) => {
    if (match.event !== reportGw || !state.gwStarted) return { ...match };
    return {
      ...match,
      started: true,
      finished: state.gwFinished,
      league_entry_1_points: scoresByLeagueEntry.get(match.league_entry_1) ?? match.league_entry_1_points,
      league_entry_2_points: scoresByLeagueEntry.get(match.league_entry_2) ?? match.league_entry_2_points,
      live: state.reportLive,
    };
  });
}

function rebuildH2HStandings(entries, matches, reportGw, previousStandings = []) {
  const previous = new Map(previousStandings.map((row) => [row.league_entry, row]));
  const rows = new Map(entries.map((entry) => [entry.id, {
    ...previous.get(entry.id), league_entry: entry.id, total: 0,
    matches_played: 0, matches_won: 0, matches_drawn: 0, matches_lost: 0,
    points_for: 0, points_against: 0,
  }]));
  const seen = new Set();
  for (const match of matches) {
    if (match.event > reportGw || !match.started || match.league_entry_1_points == null || match.league_entry_2_points == null) continue;
    const key = `${match.event}:${match.league_entry_1}:${match.league_entry_2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [id, own, other] of [
      [match.league_entry_1, match.league_entry_1_points, match.league_entry_2_points],
      [match.league_entry_2, match.league_entry_2_points, match.league_entry_1_points],
    ]) {
      const row = rows.get(id);
      if (!row) continue; // An odd-sized league can have an average-score rival.
      row.matches_played++;
      row.points_for += own;
      row.points_against += other;
      if (own > other) { row.matches_won++; row.total += 3; }
      else if (own === other) { row.matches_drawn++; row.total++; }
      else row.matches_lost++;
    }
  }
  const ranked = [...rows.values()].sort((a, b) => b.total - a.total || b.points_for - a.points_for || (a.rank || 99) - (b.rank || 99));
  ranked.forEach((row, index) => {
    row.rank = index > 0 && row.total === ranked[index - 1].total && row.points_for === ranked[index - 1].points_for
      ? ranked[index - 1].rank : index + 1;
  });
  return ranked;
}

module.exports = { LIVE_REFRESH_MS, SNAPSHOT_SCHEMA, deriveGameweekState, snapshotTtlMs, isSnapshotFresh, scoreLockedPicks, applyLiveMatchScores, rebuildH2HStandings };

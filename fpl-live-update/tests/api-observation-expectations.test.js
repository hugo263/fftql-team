'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const observed = require('./fixtures/api-audit-gw3-20260905.json');
const { scoreLockedPicks, applyLiveMatchScores, rebuildH2HStandings } = require('../live-scoring');

// Public Draft league 47275 /details observed at 2026-09-05T05:43Z.
// Each row is [GW, league entry 1, official score 1, league entry 2, official score 2].
const rawMatches = [
  [1, 251356, 20, 250649, 34], [1, 251503, 23, 251259, 36],
  [1, 251535, 66, 251219, 56], [1, 253508, 46, 251210, 46],
  [1, 256745, 44, 251164, 57], [1, 262841, 48, 251101, 43],
  [1, 250717, 41, 250959, 23], [2, 250649, 55, 250717, 41],
  [2, 250959, 43, 262841, 28], [2, 251101, 28, 256745, 42],
  [2, 251164, 54, 253508, 55], [2, 251210, 29, 251535, 52],
  [2, 251219, 39, 251503, 30], [2, 251259, 32, 251356, 41],
  [3, 251503, 10, 250649, 8], [3, 251535, 4, 251356, 8],
  [3, 253508, 0, 251259, 4], [3, 256745, 3, 251219, 14],
  [3, 262841, 0, 251210, 1], [3, 250717, 0, 251164, 5],
  [3, 250959, 0, 251101, 11],
].map(([event, league_entry_1, league_entry_1_points, league_entry_2, league_entry_2_points]) => ({
  event, league_entry_1, league_entry_1_points, league_entry_2, league_entry_2_points,
  started: true, finished: event < 3,
}));

test('observed GW3 live table matches independently calculated expected values for all 14 teams', () => {
  const entries = observed.entries.map((entry) => ({ id: entry.leagueEntry }));
  const scores = new Map(observed.entries.map((entry) => [entry.leagueEntry, entry.live]));
  const baseline = observed.entries.map((entry, index) => ({
    league_entry: entry.leagueEntry, total: entry.total, points_for: entry.pf,
    matches_played: 38, rank: index + 1,
  }));
  const replaced = applyLiveMatchScores(rawMatches, 3, scores, {
    gwStarted: true, gwFinished: false, reportLive: true,
  });
  // This is a real upstream mismatch, not a fabricated edge case: league
  // aggregate says 4 but Mac Allister's latest Draft live score is only 2.
  assert.equal(replaced.find((match) => match.event === 3 && match.league_entry_1 === 251535).league_entry_1_points, 2);
  const rows = rebuildH2HStandings(entries, replaced, 3, baseline);
  assert.equal(rows.length, 14);
  for (const expected of observed.entries) {
    const row = rows.find((item) => item.league_entry === expected.leagueEntry);
    assert.equal(row.total, expected.reconstructedTotal, expected.name + ' league points');
    assert.equal(row.points_for, expected.reconstructedPf, expected.name + ' fantasy points');
    assert.equal(row.matches_played, 3, expected.name + ' played');
    assert.equal(row.matches_won, expected.w);
    assert.equal(row.matches_drawn, expected.dr);
    assert.equal(row.matches_lost, expected.loss);
  }
  assert.equal(rows[0].league_entry, 251535);
  assert.equal(rows[1].league_entry, 251164);
  assert.equal(rows.find((row) => row.league_entry === 250717).rank,
    rows.find((row) => row.league_entry === 251101).rank, 'equal points and fantasy points share a rank');
});

test('observed completed Draft autosub positions are not swapped twice', () => {
  // Exact official event2 example: Scherpen564 is already position1,
  // displaced GK140 is position12, while subs documents the replacement.
  const payload = {
    picks: [564, 418, 473, 305, 94, 70, 268, 86, 411, 439, 464, 140, 452, 445, 6]
      .map((element, index) => ({ element, position: index + 1, multiplier: 1 })),
    entry_history: {}, subs: [{ element_in: 564, element_out: 140, event: 2 }],
  };
  // Synthetic point weights isolate inclusion/exclusion of the real picks.
  const weights = new Map(payload.picks.map((pick) => [pick.element, pick.position <= 11 ? 1 : 100]));
  assert.equal(scoreLockedPicks(payload, weights), 11);
});

test('awarded bonus is already part of the Draft live score and is counted once', () => {
  const points = new Map(observed.players.map((player) => [player.id, player.live]));
  const payload = { picks: [{ element: 350, position: 1, multiplier: 1 },
    { element: 379, position: 11, multiplier: 1 }, { element: 580, position: 14, multiplier: 1 }] };
  assert.equal(scoreLockedPicks(payload, points), 21); // A.Becker8 + Isak13; Araujo8 benched.
});

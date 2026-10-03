'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreLockedPicks } = require('../live-scoring');
const audit = require('./fixtures/defcon-audit-20260905.json');
const current = audit.rounds.find((round) => round.gw === 3);

function lineup(scoringPlayers) {
  const picks = Array.from({ length: 15 }, (_, index) => ({ element: 10000 + index, position: index + 1, multiplier: 1 }));
  const points = new Map(picks.map((pick) => [pick.element, 0]));
  for (const { id, draftTotal, position } of scoringPlayers) {
    picks[position - 1].element = id;
    points.set(id, draftTotal);
  }
  return { payload: { picks }, points };
}

test('official observation joins 652 players by unique code; GW1–GW3 totals agree with Classic and explain', () => {
  assert.equal(audit.counts.draft, 652);
  assert.equal(audit.counts.classic, 652);
  assert.deepEqual(audit.duplicateDraftCodes, []);
  assert.deepEqual(audit.duplicateClassicCodes, []);
  assert.deepEqual(audit.unmappedDraftPlayers, []);
  assert.deepEqual(audit.rounds.map((round) => round.defconAwardedCount), [31, 29, 4]);
  for (const round of audit.rounds) {
    assert.deepEqual(round.totalDiscrepancies, []);
    assert.deepEqual(round.draftExplainDiscrepancies, []);
    assert.deepEqual(round.classicExplainDiscrepancies, []);
    for (const row of round.contributors) {
      assert.equal(row.draftTotal, row.classicTotal);
      assert.equal(row.draftTotal, row.draftExplainTotal);
      assert.equal(row.classicTotal, row.classicExplainTotal);
      assert.equal(row.draftDefcon.reduce((sum, stat) => sum + stat.points, 0), 2);
    }
  }
});

test('GW3 official totals already include defensive-contribution points, including divergent Draft/Classic IDs', () => {
  assert.equal(current.contributors.length, 4);
  const araujo = current.contributors.find((row) => row.name === 'Araujo');
  assert.notEqual(araujo.id, araujo.classicId);
  for (const row of current.contributors) {
    assert.equal(row.draftExplain.reduce((sum, stat) => sum + stat.points, 0), row.draftTotal);
    assert.equal(row.classicExplain.reduce((sum, stat) => sum + stat.points, 0), row.classicTotal);
    assert.equal(row.draftDefcon[0].points, 2);
  }
});

for (const [name, expected] of [['Araujo', 8], ['Palacios', 4], ['Diop', 3], ["O'Shea", 3]]) {
  test(`${name}: official ${expected} points reach the locked XI unchanged, without a second DEFCON +2`, () => {
    const player = current.contributors.find((row) => row.name === name);
    assert.equal(player.draftTotal, expected);
    const { payload, points } = lineup([{ ...player, position: 2 }]);
    assert.equal(scoreLockedPicks(payload, points), expected);
  });
}

test('multiple DEFCON scorers sum their official totals exactly once', () => {
  const { payload, points } = lineup(current.contributors.map((player, index) => ({ ...player, position: index + 2 })));
  assert.equal(scoreLockedPicks(payload, points), 18);
});

test('DEFCON points on the bench do not leak into XI total despite Draft multiplier 1', () => {
  const araujo = current.contributors.find((row) => row.name === 'Araujo');
  const { payload, points } = lineup([{ ...araujo, position: 14 }]);
  assert.equal(scoreLockedPicks(payload, points), 0);
});

test('an official automatic substitute brings its already-inclusive points into XI only once', () => {
  const araujo = current.contributors.find((row) => row.name === 'Araujo');
  const { payload, points } = lineup([{ ...araujo, position: 14 }]);
  payload.subs = [{ element_out: payload.picks[1].element, element_in: araujo.id }];
  assert.equal(scoreLockedPicks(payload, points), 8);
});

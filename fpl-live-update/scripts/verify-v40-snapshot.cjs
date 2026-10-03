'use strict';

// Read-only verification of an actual generated snapshot, not a fixture feed.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const snapshot = JSON.parse(fs.readFileSync(process.argv[2] || 'data/snapshot.json', 'utf8'));
const { tradeReturns: returns, meta } = snapshot;
assert.equal(meta.snapshotSchema, 3);
assert.ok(returns.managerRankingByGw);
let rankingChecks = 0;
for (let gw = 0; gw <= returns.throughGw; gw++) {
  const ranking = returns.managerRankingByGw[gw];
  assert.ok(ranking);
  for (const manager of snapshot.managers) {
    const row = ranking.rows.find((item) => item.entryId === manager.entryId);
    assert.ok(row, `All managers must appear: ${manager.entryName}`);
    const rounds = Object.entries(returns.currentByGw)
      .filter(([round]) => Number(round) <= gw)
      .flatMap(([, round]) => round.rows.filter((item) => item.entryId === manager.entryId));
    if (rounds.every((item) => item.complete)) {
      assert.equal(row.net, rounds.reduce((sum, item) => sum + item.net, 0));
      assert.ok(row.rank > 0);
    } else {
      assert.equal(row.net, null);
      assert.equal(row.rank, null);
    }
    rankingChecks++;
  }
}
let contributionChecks = 0;
for (const round of Object.values(returns.currentByGw)) {
  for (const row of round.rows) {
    if (!row.complete) continue;
    const players = [...row.playersIn, ...row.playersOut];
    assert.equal(players.reduce((sum, player) => sum + player.contribution, 0), row.net);
    for (const player of row.playersIn) assert.equal(player.contribution, player.gwPoints);
    for (const player of row.playersOut) assert.equal(player.contribution, player.gwPoints === 0 ? 0 : -player.gwPoints);
    contributionChecks += players.length;
  }
}
const subExamples = [];
let lineupChecks = 0;
assert.equal(snapshot.matchDetails.length, snapshot.reportGwMatches.filter((match) => match.entry1Id && match.entry2Id).length);
for (const detail of snapshot.matchDetails) {
  const match = snapshot.reportGwMatches.find((item) => [item.entry1Id, item.entry2Id].every((id) => detail.sides.some((side) => side.entryId === id)));
  assert.ok(match);
  for (const side of detail.sides) {
    const xi = side.players.filter((player) => player.countsForTeam);
    const bench = side.players.filter((player) => !player.countsForTeam);
    assert.equal(side.players.length, 15);
    assert.equal(new Set(side.players.map((player) => player.id)).size, 15);
    assert.equal(new Set(side.players.map((player) => player.position)).size, 15);
    assert.equal(xi.length, 11);
    assert.equal(bench.length, 4);
    assert.ok(xi.every((player) => player.position <= 11));
    assert.ok(bench.every((player) => player.position > 11));
    assert.equal(xi.filter((player) => player.pos === 'GKP').length, 1);
    assert.ok(xi.filter((player) => player.pos === 'DEF').length >= 3);
    assert.ok(xi.filter((player) => player.pos === 'MID').length >= 2);
    assert.ok(xi.filter((player) => player.pos === 'FWD').length >= 1);
    assert.equal(side.score, xi.reduce((sum, player) => sum + player.points, 0));
    assert.equal(side.score, match.entry1Id === side.entryId ? match.entry1Points : match.entry2Points);
    assert.equal(side.score, snapshot.managers.find((manager) => manager.entryId === side.entryId).reportGwPoints);
    for (const sub of side.substitutions) {
      assert.ok(bench.some((player) => player.id === sub.element_out));
      assert.ok(xi.some((player) => player.id === sub.element_in));
      subExamples.push({ manager: side.entryName,
        out: bench.find((player) => player.id === sub.element_out).name,
        in: xi.find((player) => player.id === sub.element_in).name,
        pending: sub.pending, source: sub.source });
    }
    lineupChecks++;
  }
}
console.log(JSON.stringify({ updated: meta.updated, gw: meta.reportGw, rankingChecks, contributionChecks, lineupChecks,
  topManagers: returns.managerRankingByGw[returns.throughGw].rows.slice(0, 3).map(({ manager, rank, net }) => ({ manager, rank, net })),
  substitutions: subExamples }, null, 2));

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOwnershipSnapshot, isValidOwnershipSnapshot, applyOwnership, ownershipCacheKey } = require('../totw-ownership');

function fixture(overrides = {}) {
  const entries = [{ id: 1, entry_id: 101, entry_name: '历史甲队' }, { id: 2, entry_id: 202, entry_name: '历史乙队' }];
  return {
    leagueId: 47275, season: '2026/27', gw: 3, deadline: '2026-08-29T10:00:00Z', now: Date.parse('2026-09-07T00:00:00Z'), entries,
    picksByEntry: new Map(entries.map((entry, index) => [entry.entry_id, {
      entryId: entry.entry_id, gw: 3,
      payload: { entry_history: { event: 3 }, picks: Array.from({ length: 15 }, (_, i) => ({ element: index * 15 + i + 1, position: i + 1, multiplier: 1 })) },
    }])), ...overrides,
  };
}
const copy = (value) => JSON.parse(JSON.stringify(value));

test('all 15 official picks, including the bench, lock ownership at the GW deadline', () => {
  const input = fixture();
  const snapshot = buildOwnershipSnapshot(input);
  assert.equal(isValidOwnershipSnapshot(snapshot, input), true);
  assert.equal(snapshot.lockedAt, '2026-08-29T10:00:00.000Z');
  assert.equal(Object.keys(snapshot.owners).length, 30);
  assert.equal(snapshot.owners[15], 101);
  assert.equal(snapshot.owners[30], 202);
  assert.equal(snapshot.managers[0].ownerName, '历史甲队');
  assert.equal(buildOwnershipSnapshot({ ...input, now: Date.parse(input.deadline) - 1 }), null);
  assert.ok(buildOwnershipSnapshot({ ...input, now: Date.parse(input.deadline) }));
});

test('historical owned and free players ignore later transactions and preserve source names', () => {
  const input = fixture();
  const snapshot = buildOwnershipSnapshot(input);
  const original = { formation: '4-4-2', players: [{ id: 15, owner: 202, gwPoints: 7 }, { id: 44, owner: 101, gwPoints: 9 }] };
  const mapped = applyOwnership(original, snapshot);
  assert.deepEqual(mapped.players.map(({ owner, ownerName, ownershipStatus }) => ({ owner, ownerName, ownershipStatus })), [
    { owner: 101, ownerName: '历史甲队', ownershipStatus: 'owned' }, { owner: null, ownerName: null, ownershipStatus: 'free' },
  ]);
  assert.equal(mapped.players[0].gwPoints, 7);
  assert.equal(original.players[0].owner, 202);
  assert.notEqual(mapped, original);
  assert.notEqual(mapped.players[0], original.players[0]);
  input.entries[0].entry_name = '后来的新名称';
  assert.equal(isValidOwnershipSnapshot(snapshot, input), true);
  assert.equal(applyOwnership(original, snapshot).players[0].ownerName, '历史甲队');
  assert.equal(applyOwnership({ ...original, players: [{ id: 44, owner: 202, gwPoints: 12 }] }, snapshot).players[0].ownershipStatus, 'free');
});

test('points can update without refreezing ownership or the Team of the Week selection', () => {
  const snapshot = buildOwnershipSnapshot(fixture());
  const first = applyOwnership({ players: [{ id: 1, gwPoints: 4 }] }, snapshot);
  const corrected = applyOwnership({ players: [{ id: 2, gwPoints: 8 }, { id: 88, gwPoints: 9 }] }, snapshot);
  assert.equal(corrected.players[0].gwPoints, 8);
  assert.equal(corrected.players[1].ownershipStatus, 'free');
  assert.deepEqual(corrected.ownership, first.ownership);
});

test('missing, empty, partial and duplicate sources never freeze or declare a free agent', () => {
  const variants = [
    (x) => { x.entries = []; },
    (x) => { x.picksByEntry.delete(202); },
    (x) => { x.picksByEntry.get(101).payload.picks = []; },
    (x) => { x.picksByEntry.get(101).payload.picks.pop(); },
    (x) => { x.picksByEntry.get(101).payload.picks[1].element = 1; },
    (x) => { x.picksByEntry.get(202).payload.picks[0].element = 1; },
    (x) => { x.picksByEntry.get(101).payload.picks[0].position = 0; },
    (x) => { x.picksByEntry.get(101).payload.picks[0].position = 16; },
    (x) => { x.picksByEntry.get(101).payload.picks[1].position = 1; },
    (x) => { x.picksByEntry.get(101).payload.picks[0].element = null; },
    (x) => { x.entries[1].id = 1; },
    (x) => { x.entries[1].entry_id = 101; },
  ];
  for (const change of variants) {
    const input = fixture(); change(input);
    const snapshot = buildOwnershipSnapshot(input);
    assert.equal(snapshot, null);
    const result = applyOwnership({ players: [{ id: 1, owner: 101 }, { id: 99, owner: null }] }, snapshot);
    assert.deepEqual(result.players.map((p) => [p.owner, p.ownerName, p.ownershipStatus]), [[null, null, 'unknown'], [null, null, 'unknown']]);
    assert.equal(result.ownership.status, 'unavailable');
  }
});

test('the actual request envelope and any official response identities must match', () => {
  const variants = [
    (envelope) => { envelope.entryId = 202; },
    (envelope) => { envelope.gw = 2; },
    (envelope) => { delete envelope.gw; },
    (envelope) => { envelope.leagueId = 999; },
    (envelope) => { envelope.payload.entry = 202; },
    (envelope) => { envelope.payload.event = 2; },
    (envelope) => { envelope.payload.entry_history.event = 2; },
    (envelope) => { envelope.payload.entry_history.entry = 202; },
    (envelope) => { envelope.payload.subs = [{ event: 2 }]; },
    (envelope) => { envelope.payload.automatic_subs = [{ event: 2 }]; },
    (envelope) => { envelope.payload.subs = {}; },
  ];
  for (const change of variants) {
    const input = fixture(); change(input.picksByEntry.get(101));
    assert.equal(buildOwnershipSnapshot(input), null);
  }
  const input = fixture();
  input.picksByEntry.get(101).payload.entry_history = {}; // Normal official Draft response.
  input.picksByEntry.get(101).payload.subs = [{ element_in: 15, element_out: 1, event: 3 }];
  input.picksByEntry.get(101).payload.automatic_subs = [];
  assert.ok(buildOwnershipSnapshot(input));
});

test('cache keys isolate league, season, GW and schema and reject path-like identities', () => {
  const input = fixture();
  const key = ownershipCacheKey(input);
  assert.equal(key, 'totw-ownership-v1-league47275-season2026-27-gw3.json');
  assert.notEqual(key, ownershipCacheKey({ ...input, leagueId: 99 }));
  assert.notEqual(key, ownershipCacheKey({ ...input, gw: 2 }));
  assert.equal(ownershipCacheKey({ ...input, season: '../../bad' }), null);
  assert.equal(ownershipCacheKey({ ...input, leagueId: '../47275' }), null);
  assert.equal(ownershipCacheKey({ ...input, season: '2025/26' }), null);
  assert.equal(ownershipCacheKey({ ...input, season: '2026/28' }), null);
});

test('cache validation rejects mismatched identity, membership, deadline, timestamp and version', () => {
  const input = fixture();
  const snapshot = buildOwnershipSnapshot(input);
  for (const context of [
    { ...input, leagueId: 999 }, { ...input, gw: 2 }, { ...input, season: '2025/26' },
    { ...input, deadline: '2026-08-29T11:00:00Z' }, { ...input, entries: input.entries.slice(0, 1) },
    { ...input, entries: [] }, { ...input, entries: [{ id: 1, entry_id: 101 }, { id: 22, entry_id: 202 }] },
    { ...input, now: input.now - 1 },
  ]) assert.equal(isValidOwnershipSnapshot(snapshot, context), false);
  for (const changes of [
    { schema: 0 }, { source: 'current-element-status' }, { status: 'pending' }, { lockedAt: null },
    { capturedAt: 'invalid' }, { capturedAt: '2026-08-01T00:00:00Z' }, { managers: [] }, { owners: {} },
  ]) assert.equal(isValidOwnershipSnapshot({ ...snapshot, ...changes }, input), false);
  assert.equal(isValidOwnershipSnapshot(copy(snapshot), input), true);
});

test('corrupt owner indexes and manager rosters are rejected, not partially recovered', () => {
  const input = fixture();
  const variants = [
    (x) => { delete x.owners[1]; }, (x) => { x.owners[1] = 202; }, (x) => { x.owners[99] = 101; },
    (x) => { x.managers[0].picks.pop(); }, (x) => { x.managers[0].picks[0].position = 2; },
    (x) => { x.managers[0].ownerName = null; }, (x) => { x.managers[1].entryId = 101; },
    (x) => { x.managers[1].picks[0].element = 1; },
  ];
  for (const change of variants) {
    const snapshot = buildOwnershipSnapshot(input); change(snapshot);
    assert.equal(isValidOwnershipSnapshot(snapshot, input), false);
    assert.equal(applyOwnership({ players: [{ id: 88, owner: null }] }, snapshot).players[0].ownershipStatus, 'unknown');
  }
});

test('manager display names remain immutable raw text for the frontend to escape', () => {
  const input = fixture();
  input.entries[0].entry_name = '<img src=x onerror=alert(1)> & "甲"';
  const snapshot = buildOwnershipSnapshot(input);
  assert.equal(isValidOwnershipSnapshot(copy(snapshot), input), true);
  assert.equal(applyOwnership({ players: [{ id: 1 }] }, snapshot).players[0].ownerName, input.entries[0].entry_name);
  input.entries[0].entry_name = 'new';
  assert.equal(snapshot.managers[0].ownerName, '<img src=x onerror=alert(1)> & "甲"');
});

test('invalid player identities stay unknown even in a valid snapshot', () => {
  const snapshot = buildOwnershipSnapshot(fixture());
  const result = applyOwnership({ players: [{ id: null }, { id: '' }, { id: -1 }, { id: {} }] }, snapshot);
  assert.ok(result.players.every((player) => player.ownershipStatus === 'unknown'));
  assert.deepEqual(applyOwnership({ players: [] }, snapshot).players, []);
  assert.deepEqual(applyOwnership([], null), []);
  assert.equal(applyOwnership(null, snapshot), null);
});

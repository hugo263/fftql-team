'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMatchCentreService, validateGameweek, TTL_MS, FINALIZING_TTL_MS, IDLE_TTL_MS, refreshPlan, BOOTSTRAP_TTL_MS } = require('../match-centre');

const copy = value => JSON.parse(JSON.stringify(value));

test('explicit global refresh bypasses idle and bootstrap caches while automatic reads stay cached', async () => {
  const h=setup(); h.source.fixtures[0].finished=true;
  h.source.boot.events[3].finished=true;
  await h.service.get();
  const count=h.calls.length;
  await h.service.get(); assert.equal(h.calls.length,count);
  h.source.fixtures[0].team_h_score=3;
  const next=await h.service.get(undefined,true);
  assert.equal(next.fixtures[0].team_h_score,3);
  assert.ok(h.calls.slice(count).some(url=>url.endsWith('bootstrap-static/')));
  assert.ok(h.calls.slice(count).some(url=>url.endsWith('fixtures/')));
});

test('legacy event identities gain official stable codes without changing observations or scoring', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fpl-code-upgrade-')),cachePath=path.join(dir,'cache.json');
  try {
    const h=setup({cachePath}),before=await h.service.get();
    assert.equal(before.events[0].player.code,10010);
    const saved=JSON.parse(fs.readFileSync(cachePath,'utf8'));
    for(const record of saved.records){record.payload.meta.presentationVersion=3;for(const event of record.payload.events)delete event.player.code;}
    fs.writeFileSync(cachePath,JSON.stringify(saved));
    const restarted=createMatchCentreService({fetchJson:h.fetchJson,cachePath,now:h.time});
    const after=await restarted.get();
    assert.equal(after.meta.presentationVersion,4);assert.deepEqual(after.events,before.events);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('saved and missed penalties use official points, deduplicate and emit correction deltas', async()=>{
  const h=setup();await h.service.get();
  h.scoring(13,'penalties_saved',1,5);h.scoring(12,'penalties_missed',1,-2);h.advance();
  const first=await h.service.get();
  assert.equal(first.events.find(e=>e.kind==='penalty_saved').points,5);
  assert.equal(first.events.find(e=>e.kind==='penalty_missed').points,-2);
  h.advance();const same=await h.service.get();assert.equal(same.events.length,first.events.length);
  h.scoring(12,'penalties_missed',0,0);h.advance();
  assert.equal((await h.service.get()).events.filter(e=>e.kind==='penalty_missed').at(-1).points,2);
});

test('official bonus is observed separately from BPS, with corrections and no duplicate awards', async () => {
  const h=setup();
  h.scoring(10,'bps',30,0);
  const first=await h.service.get();
  assert.equal(first.events.filter(e=>e.kind==='bonus').length,0);
  h.scoring(10,'bonus',3,3);h.advance();
  const awarded=await h.service.get();
  const bonus=awarded.events.filter(e=>e.kind==='bonus');
  assert.equal(bonus.length,1);assert.equal(bonus[0].points,3);assert.equal(bonus[0].baseline,false);
  h.advance();const unchanged=await h.service.get();
  assert.equal(unchanged.events.filter(e=>e.kind==='bonus').length,1);
  h.scoring(10,'bonus',2,2);h.advance();
  assert.equal((await h.service.get()).events.filter(e=>e.kind==='bonus').at(-1).points,-1);
});

test('red card totals come from current per-side fixture statistics, not accumulated event history', async () => {
  const h=setup();h.count('red_cards',10,1);h.count('red_cards',11,1);h.count('red_cards',12,1,'a');
  const first=await h.service.get();assert.deepEqual(first.fixtures[0].redCards,{home:2,away:1});
  h.count('red_cards',10,0);h.advance();
  assert.deepEqual((await h.service.get()).fixtures[0].redCards,{home:1,away:1});
});

test('legacy observation cache upgrades bonus as baseline while retaining existing history', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fpl-bonus-upgrade-'));
  const cachePath=path.join(dir,'cache.json');
  try {
    const h=setup({cachePath});const before=await h.service.get();
    const saved=JSON.parse(fs.readFileSync(cachePath,'utf8'));
    saved.records.forEach(record=>{delete record.payload.meta.presentationVersion;record.state=record.state.filter(([key])=>!key.endsWith(':bonus'));});
    fs.writeFileSync(cachePath,JSON.stringify(saved));
    h.scoring(10,'bonus',3,3);
    const restarted=createMatchCentreService({fetchJson:h.fetchJson,cachePath,now:h.time});
    const after=await restarted.get();
    assert.equal(after.meta.presentationVersion,4);
    assert.ok(before.events.every(e=>after.events.some(n=>n.id===e.id)));
    assert.equal(after.events.find(e=>e.kind==='bonus').baseline,true);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('idle calendar uses three hours and wakes before the next GW kickoff', () => {
  const now = Date.parse('2026-09-12T15:00:00Z');
  const played = {...fixture(), finished_provisional:true};
  assert.equal(refreshPlan([played], now).refreshSeconds, 10800);
  assert.equal(Date.parse(refreshPlan([played], now).nextRefreshAt), now + IDLE_TTL_MS);
  const upcoming = {...fixture(41, 5, false), kickoff_time:new Date(now+90*60000).toISOString()};
  const gap = refreshPlan([played, upcoming], now);
  assert.equal(gap.refreshMode,'idle');
  assert.equal(Date.parse(gap.nextRefreshAt), now+89*60000);
  assert.equal(refreshPlan([played, upcoming],now+89*60000).refreshSeconds,10);
});

test('half-time and delayed started flags remain fast; old unstarted fixtures do not force polling forever', () => {
  const now = Date.parse('2026-09-12T15:00:00Z');
  assert.equal(refreshPlan([{...fixture(), minutes:45}],now).refreshMode,'match');
  assert.equal(refreshPlan([fixture(31,4,false)],now).refreshMode,'match');
  assert.equal(refreshPlan([fixture(31,4,false)],now+5*60*60000).refreshMode,'idle');
  assert.equal(refreshPlan([{...fixture(31,4,false),kickoff_time:null}],now).refreshMode,'idle');
});

test('idle repeated server checks do not request upstream until three hours, then recalculate', async () => {
  const h=setup(); h.source.fixtures[0].finished_provisional=true;
  h.source.boot.events[3].finished=true; h.source.boot.events[3].data_checked=true;
  const first=await h.service.get(); const calls=h.calls.length;
  assert.equal(first.meta.refreshSeconds,10800);
  for(let i=0;i<179;i++){h.advance(60000);await h.service.get();}
  assert.equal(h.calls.length,calls);
  h.advance(60000); const next=await h.service.get();
  assert.ok(h.calls.length>calls);
  assert.equal(next.meta.firstSourceTime,first.meta.firstSourceTime);
  assert.equal(Date.parse(next.meta.updated)-Date.parse(first.meta.updated),IDLE_TTL_MS);
});

test('settled idle cache wakes across GW kickoff and final whistle keeps official corrections active', async () => {
  const h=setup();h.source.fixtures[0].finished=true;
  h.source.boot.events[3].finished=true; h.source.boot.events[3].data_checked=true;
  h.source.fixtures.push({...fixture(41,5,false),kickoff_time:new Date(h.time()+10*60000).toISOString()});
  const first=await h.service.get();assert.equal(first.meta.gw,4);
  assert.equal(Date.parse(first.meta.nextRefreshAt),h.time()+9*60000);
  h.advance(9*60000);const pre=await h.service.get();assert.equal(pre.meta.refreshSeconds,10);
  h.advance();h.source.fixtures[1].started=true;
  h.source.live.elements.forEach(p=>p.explain[0].fixture=41);
  const during=await h.service.get();assert.equal(during.meta.gw,5);assert.equal(during.meta.refreshSeconds,10);
  h.advance();h.source.fixtures[1].finished_provisional=true;
  const after=await h.service.get();assert.equal(after.meta.refreshSeconds,60);
  assert.equal(after.meta.live,false);assert.equal(after.meta.refreshMode,'finalizing');
  h.source.boot.events[4].finished=true;h.source.boot.events[4].data_checked=true;
  h.advance(FINALIZING_TTL_MS);
  const settled=await h.service.get();assert.equal(settled.meta.refreshSeconds,10800);
});
function stat(identifier, value, points) { return { identifier, value, points, points_modification: 0 }; }
function fixture(id = 31, event = 4, started = true) {
  return { id, event, kickoff_time: '2026-09-12T14:00:00Z', started,
    finished: false, finished_provisional: false, minutes: started ? 65 : 0,
    team_h: 1, team_a: 2, team_h_score: started ? 0 : null, team_a_score: started ? 0 : null,
    stats: ['goals_scored', 'assists', 'yellow_cards', 'red_cards', 'defensive_contribution'].map(identifier => ({ identifier, h: [], a: [] })) };
}
function setup(options = {}) {
  let time = Date.parse('2026-09-12T15:00:00Z');
  const boot = { events: Array.from({ length: 38 }, (_, i) => ({ id: i + 1, name: `Gameweek ${i + 1}`,
    deadline_time: new Date(Date.parse('2026-09-12T10:00:00Z') + (i - 3) * 7 * 86400000).toISOString(), is_current: i === 3, finished: i < 3, data_checked: i < 3 })),
    teams: [{ id: 1, code: 3, name: 'Arsenal', short_name: 'ARS' }, { id: 2, code: 7, name: 'Aston Villa', short_name: 'AVL' }],
    elements: [{ id: 10, code: 10010, team: 1, element_type: 2, web_name: 'Defender' },
      { id: 11, code: 10011, team: 1, element_type: 3, web_name: 'Midfielder' },
      { id: 12, code: 10012, team: 2, element_type: 4, web_name: 'Forward' },
      { id: 13, code: 10013, team: 1, element_type: 1, web_name: 'Keeper' }] };
  const source = { boot, fixtures: [fixture()], live: { elements: [
    { id: 10, explain: [{ fixture: 31, stats: [stat('minutes', 65, 2), stat('clean_sheets', 1, 4)] }] },
    { id: 11, explain: [{ fixture: 31, stats: [stat('minutes', 65, 2), stat('clean_sheets', 1, 1)] }] },
    { id: 12, explain: [{ fixture: 31, stats: [stat('minutes', 65, 2)] }] },
    { id: 13, explain: [{ fixture: 31, stats: [stat('minutes', 65, 2), stat('clean_sheets', 1, 4)] }] },
  ] }, fail: null };
  const calls = [];
  const fetchJson = async url => {
    calls.push(url);
    if (source.fail?.(url)) throw new Error('upstream offline');
    if (url.endsWith('bootstrap-static/')) return copy(source.boot);
    if (url.endsWith('fixtures/')) return copy(source.fixtures);
    if (/event\/\d+\/live\/$/.test(url)) return copy(source.live);
    throw Error(`Unexpected URL ${url}`);
  };
  const service = createMatchCentreService({ fetchJson, now: () => time, ...options });
  const scoring = (player, identifier, value, points) => {
    const row = source.live.elements.find(p => p.id === player).explain[0];
    row.stats = row.stats.filter(s => s.identifier !== identifier);
    if (value !== null) row.stats.push(stat(identifier, value, points));
  };
  const count = (identifier, player, value, side = 'h') => {
    const s = source.fixtures[0].stats.find(s => s.identifier === identifier);
    s[side] = s[side].filter(p => p.element !== player);
    if (value) s[side].push({ element: player, value });
  };
  return { service, source, calls, fetchJson, scoring, count, time: () => time, advance: (n = TTL_MS) => { time += n; } };
}

test('GW validation is strict and never sends arbitrary upstream paths', async () => {
  for (const value of [0, 39, -1, 2.5, '', '01', ' 4', '4 ', '4abc', '1e1', {}, [], true]) {
    assert.throws(() => validateGameweek(value), error => error.statusCode === 400);
  }
  assert.equal(validateGameweek('38'), 38);
  assert.equal(validateGameweek(undefined), null);
  const { service, calls } = setup();
  await assert.rejects(service.get('../config.json'), { statusCode: 400 });
  assert.equal(calls.length, 0);
});

test('initial events are cumulative baselines with official per-fixture points and no invented match minute', async () => {
  const h = setup();
  h.count('goals_scored', 12, 2, 'a');
  h.scoring(12, 'goals_scored', 2, 8);
  h.scoring(10, 'defensive_contribution', 10, 2);
  const out = await h.service.get();
  assert.equal(out.meta.gw, 4);
  assert.equal(out.meta.source, 'Official FPL');
  assert.equal(out.meta.live, true);
  assert.equal(out.meta.finished, false);
  assert.equal(out.meta.data_checked, false);
  assert.equal(out.gameweeks.length, 38);
  const goal = out.events.find(e => e.kind === 'goal');
  assert.equal(goal.points, 8);
  assert.equal(goal.value, 2);
  assert.equal(goal.delta, 2);
  assert.equal(goal.player.team, 2);
  assert.equal(goal.player.position, 'FWD');
  assert.equal(out.events.find(e => e.kind === 'dc').points, 2);
  assert.ok(out.events.every(e => e.baseline && /本场累计/.test(e.detail) && !('minute' in e)));
  assert.equal(out.fixtures[0].home.code, 3);
  assert.equal(out.meta.firstSourceTime, out.meta.updated);
});

test('CS loss only reverses previously observed points and preserves substituted player official CS', async () => {
  const h = setup();
  const first = await h.service.get(4);
  h.advance();
  h.source.fixtures[0].team_a_score = 1;
  h.scoring(10, 'clean_sheets', null);
  h.scoring(11, 'clean_sheets', 0, 0);
  h.scoring(13, 'minutes', 61, 2); // Substituted keeper keeps the official CS.
  const next = await h.service.get(4);
  const losses = next.events.filter(e => e.kind === 'cs_lost');
  assert.deepEqual(losses.map(e => [e.player.id, e.points, e.delta]), [[10, -4, -1], [11, -1, -1]]);
  assert.ok(losses.every(e => !e.baseline && e.observedAt === new Date(h.time()).toISOString()));
  assert.ok(!losses.some(e => e.player.id === 12 || e.player.id === 13));
  assert.equal(next.meta.firstSourceTime, first.meta.firstSourceTime);
  assert.deepEqual(next.events.slice(0, first.events.length), first.events);
  h.advance();
  assert.equal((await h.service.get(4)).events.length, next.events.length);
});

test('first observation after conceding produces no imaginary CS loss', async () => {
  const h = setup();
  for (const id of [10, 11, 13]) h.scoring(id, 'clean_sheets', null);
  h.source.fixtures[0].team_a_score = 1;
  assert.deepEqual((await h.service.get(4)).events, []);
});

test('absent whole explain or fixture stat collection does not invent a scoring reversal', async () => {
  const h = setup();
  h.count('goals_scored', 12, 1, 'a');
  h.scoring(12, 'goals_scored', 1, 4);
  const before = await h.service.get(4);
  h.source.live.elements[0].explain = [];
  h.source.fixtures[0].stats = [];
  h.advance();
  const after = await h.service.get(4);
  assert.deepEqual(after.events, before.events);
});

test('DC only changes with official award points; corrections can be negative', async () => {
  const h = setup();
  h.scoring(10, 'defensive_contribution', 10, 2);
  const first = await h.service.get(4);
  h.advance();
  h.scoring(10, 'defensive_contribution', 11, 2);
  assert.equal((await h.service.get(4)).events.length, first.events.length);
  h.advance();
  h.scoring(10, 'defensive_contribution', null);
  const correction = (await h.service.get(4)).events.filter(e => e.kind === 'dc').at(-1);
  assert.equal(correction.points, -2);
  assert.equal(correction.baseline, false);
});

test('new goals and downward corrections retain stable history IDs', async () => {
  const h = setup();
  await h.service.get(4);
  h.advance();
  h.count('goals_scored', 12, 1, 'a');
  h.scoring(12, 'goals_scored', 1, 4);
  const goal = (await h.service.get(4)).events.at(-1);
  assert.equal(goal.kind, 'goal');
  assert.equal(goal.baseline, false);
  assert.equal(goal.points, 4);
  h.advance();
  h.count('goals_scored', 12, 0, 'a');
  h.scoring(12, 'goals_scored', null);
  const corrected = await h.service.get(4);
  assert.equal(corrected.events.at(-1).points, -4);
  assert.equal(corrected.events.at(-1).delta, -1);
  assert.deepEqual(corrected.events.find(e => e.id === goal.id), goal);
});

test('a red card does not double count a second yellow absent from official explain', async () => {
  const h = setup();
  h.count('yellow_cards', 12, 1, 'a');
  h.scoring(12, 'yellow_cards', 1, -1);
  await h.service.get(4);
  h.advance();
  h.count('red_cards', 12, 1, 'a');
  h.scoring(12, 'yellow_cards', null);
  h.scoring(12, 'red_cards', 1, -3);
  const cards = (await h.service.get(4)).events.filter(e => ['red', 'yellow'].includes(e.kind));
  assert.equal(cards.reduce((n, e) => n + e.points, 0), -3);
  assert.equal(cards.find(e => e.kind === 'red').points, -3);
  assert.ok(cards.some(e => e.kind === 'yellow' && e.points === 1));
});

test('missing official event points stay null until official detail confirms them', async () => {
  const h = setup();
  h.count('goals_scored', 12, 1, 'a');
  const first = await h.service.get(4);
  assert.equal(first.events.find(e => e.kind === 'goal').points, null);
  h.advance();
  h.scoring(12, 'goals_scored', 1, 4);
  const last = (await h.service.get(4)).events.at(-1);
  assert.equal(last.points, 4);
  assert.equal(last.delta, 0);
});

test('delayed points for a second goal do not award the first goal twice', async () => {
  const h = setup();
  h.count('goals_scored', 12, 1, 'a');
  h.scoring(12, 'goals_scored', 1, 4);
  await h.service.get(4);
  h.advance();
  h.count('goals_scored', 12, 2, 'a');
  const pending = await h.service.get(4);
  assert.equal(pending.events.at(-1).points, null);
  h.advance();
  h.scoring(12, 'goals_scored', 2, 8);
  const goals = (await h.service.get(4)).events.filter(e => e.kind === 'goal');
  assert.equal(goals.at(-1).points, 4);
  assert.equal(goals.reduce((n, e) => n + (e.points || 0), 0), 8);
});

test('wrong Classic player/team/fixture references cannot label events as another player', async () => {
  const h = setup();
  h.count('goals_scored', 99999, 1);
  h.count('assists', 12, 1, 'h'); // Actual player is away; never join this as a home assist.
  h.source.live.elements.push({ id: 99999, explain: [{ fixture: 31, stats: [stat('goals_scored', 1, 6)] }] });
  h.source.live.elements[0].explain.push({ fixture: 99999, stats: [stat('goals_scored', 1, 6)] });
  const out = await h.service.get(4);
  assert.ok(out.meta.ignoredReferences >= 3);
  assert.ok(!out.events.some(e => e.kind === 'goal' || e.kind === 'assist' || e.player.id === 99999));
});

test('rejects Draft live shape and fixtures with missing or mismatched event identities', async () => {
  const h = setup();
  h.source.live = { elements: { 10: { stats: {}, explain: [] } } };
  await assert.rejects(h.service.get(4), /Classic live/);
  const bad = setup();
  delete bad.source.fixtures[0].event;
  await assert.rejects(bad.service.get(4), /fixture identity/);
  const duplicate = setup();
  duplicate.source.fixtures.push(copy(duplicate.source.fixtures[0]));
  await assert.rejects(duplicate.service.get(4), /fixture identity/);
});

test('10-second caching, 15-minute bootstrap caching, and concurrency merging', async () => {
  const h = setup();
  const [first, other] = await Promise.all([h.service.get(), h.service.get('4'), h.service.get(4)]);
  assert.deepEqual(first, other);
  assert.equal(h.calls.length, 3);
  first.events[0].player.name = 'mutated client';
  h.advance(TTL_MS - 1);
  assert.notEqual((await h.service.get(4)).events[0].player.name, 'mutated client');
  assert.equal(h.calls.length, 3);
  h.advance(1);
  await Promise.all([h.service.get(4), h.service.get(4)]);
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls.filter(url => url.endsWith('bootstrap-static/')).length, 1);
  h.advance(BOOTSTRAP_TTL_MS);
  await h.service.get(4);
  assert.equal(h.calls.filter(url => url.endsWith('bootstrap-static/')).length, 2);
});

test('failure falls back stale while all source and event times remain unchanged', async () => {
  const h = setup();
  const first = await h.service.get(4);
  h.advance();
  h.source.fail = url => url.includes('/live/');
  const stale = await h.service.get(4);
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.updated, first.meta.updated);
  assert.equal(stale.meta.firstSourceTime, first.meta.firstSourceTime);
  assert.deepEqual(stale.events, first.events);
  const calls = h.calls.length;
  await h.service.get(4);
  assert.equal(h.calls.length, calls);
  const empty = setup();
  empty.source.fail = () => true;
  await assert.rejects(empty.service.get(), /offline/);
});

test('default advances at the current deadline even before its real kickoff', async () => {
  const h = setup();
  h.source.fixtures = [fixture(31, 3), fixture(41, 4, false)];
  h.source.fixtures[0].finished = h.source.fixtures[0].finished_provisional = true;
  assert.equal((await h.service.get()).meta.gw, 4);
  h.advance();
  h.source.fixtures[1].started = true;
  assert.equal((await h.service.get()).meta.gw, 4);
});

test('empty and future gameweeks remain empty and future requests do not stick in flight', async () => {
  const h = setup();
  h.source.fixtures = [fixture(51, 5, false)];
  const empty = await h.service.get(6);
  assert.deepEqual(empty.fixtures, []);
  assert.deepEqual(empty.events, []);
  const future = await h.service.get(5);
  assert.equal(future.fixtures[0].team_h_score, null);
  assert.deepEqual(future.events, []);
  assert.ok(!h.calls.some(url => url.includes('/live/')));
  h.advance();
  h.source.fixtures[0].started = true;
  h.source.live.elements.forEach(p => { p.explain[0].fixture = 51; });
  assert.ok((await h.service.get(5)).events.length > 0);
});

test('persisted event history survives restart without refreshing firstSourceTime', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-centre-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cachePath = path.join(dir, 'match-centre-v1.json');
  const h = setup({ cachePath });
  const first = await h.service.get(4);
  h.advance();
  h.scoring(10, 'clean_sheets', null);
  const restarted = createMatchCentreService({ fetchJson: h.fetchJson, cachePath, now: h.time });
  const second = await restarted.get(4);
  assert.equal(second.meta.firstSourceTime, first.meta.firstSourceTime);
  assert.deepEqual(second.events.slice(0, first.events.length), first.events);
  assert.equal(second.events.at(-1).kind, 'cs_lost');
  assert.equal(second.events.at(-1).baseline, false);
  h.advance();
  h.source.fail = () => true;
  const offline = createMatchCentreService({ fetchJson: h.fetchJson, cachePath, now: h.time });
  assert.equal((await offline.get()).meta.updated, second.meta.updated);
  assert.equal((await offline.get(4)).meta.stale, true);
});

test('the caches retain at most three gameweeks and pin the default GW during history browsing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-centre-bound-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cachePath = path.join(dir, 'match-centre-v1.json');
  const h = setup({ cachePath });
  for (const gw of [4, 5, 6, 7]) await h.service.get(gw);
  const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(saved.records.length, 3);
  assert.deepEqual(saved.records.map(r => r.gw), [4, 6, 7]);
  const calls = h.calls.length;
  await h.service.get(4);
  assert.equal(h.calls.length, calls);
  h.advance();
  h.scoring(10, 'clean_sheets', null);
  const current = await h.service.get(4);
  assert.equal(current.events.at(-1).kind, 'cs_lost');
  assert.equal(current.events.at(-1).points, -4);
});

test('different GW requests cannot fan out to unlimited upstream calls', async () => {
  const h = setup();
  h.source.fixtures = [fixture(11, 1), fixture(21, 2), fixture(31, 3), fixture(41, 4)];
  const pending = [];
  let active = 0;
  let maximum = 0;
  const service = createMatchCentreService({ now: h.time, fetchJson: async url => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      if (url.includes('/live/')) await new Promise(resolve => pending.push(resolve));
      return await h.fetchJson(url);
    } finally { active--; }
  } });
  const attempts = [1, 2, 3, 4].map(gw => service.get(gw).then(value => ({ value }), error => ({ error })));
  // One event-loop turn lets the shared bootstrap/fixtures read and three live calls start.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 3);
  assert.ok(maximum <= 4);
  pending.forEach(resolve => resolve());
  const results = await Promise.all(attempts);
  assert.equal(results.filter(r => r.error?.statusCode === 503).length, 1);
  assert.equal(results.filter(r => r.value).length, 3);
  assert.equal(h.calls.filter(url => url.includes('/live/')).length, 3);
});

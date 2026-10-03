'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../public/fixtures');
const snapshot = () => ({ meta: { reportGw: 3, lastFinishedGw: 3, reportLive: false, upcomingGw: 4 },
  managers: [{entryId:11,rank:2},{entryId:22,rank:1}],
  events: [{id:4,deadline:'2026-09-12T12:30:00Z'}],
  leagueSchedule: [3,4,5,6,7,8,9,10,38].map(gw => ({gw,entry1Id:11,entry2Id:22,entry1:'A',entry2:'B',started:gw===3,finished:gw===3,entry1Points:0,entry2Points:0})) });
test('full calendar defaults to next unfinished round and caps windows at season end', () => {
  const s = snapshot();
  assert.equal(fx.defaultGw(s),4);
  assert.deepEqual(fx.model(s,null,6).gws,[4,5,6,7,8,9]);
  assert.deepEqual(fx.model(s,38,6).gws,[38]);
  assert.equal(fx.defaultGw({...s,meta:{...s.meta,upcomingGw:39}}),38);
  assert.equal(fx.defaultGw({...s,meta:{...s.meta,reportLive:true}}),3);
});
test('team filters and chosen historical GW are stable; both sides resolve opponents', () => {
  const s = snapshot();
  assert.deepEqual(fx.model(s,3,6,'22').managers.map(m=>m.entryId),[22]);
  assert.equal(fx.model(s,3,6).from,3);
  assert.equal(fx.opponent(s.leagueSchedule[0],22).name,'A');
  assert.equal(fx.opponent(s.leagueSchedule[0],11).name,'B');
  assert.equal(fx.opponent(s.leagueSchedule[0],33),null);
});
test('future zero placeholders are not draws; true zero draws and losses remain valid', () => {
  const s = snapshot();
  assert.equal(fx.result(s.leagueSchedule[0],11),'平');
  assert.equal(fx.result(s.leagueSchedule[1],11),null);
  assert.equal(fx.result({...s.leagueSchedule[0],entry1Points:-1},11),'负');
  assert.equal(fx.result({...s.leagueSchedule[0],entry1Points:null},11),null);
});
test('average opponent, duplicate rows, unknown schedules, and Beijing cutoff are explicit', () => {
  const s = snapshot();
  assert.equal(fx.opponent({...s.leagueSchedule[0],entry2Id:null,entry2:'联赛平均分'},11).name,'联赛平均分');
  assert.equal(fx.schedule({...s,leagueSchedule:[...s.leagueSchedule,...s.leagueSchedule]}).length,9);
  assert.equal(fx.model({...s,leagueSchedule:[]},null,6).gws.length,0);
  assert.equal(fx.dateText(s,4),'09/12 20:30');
  assert.equal(fx.dateText(s,5),'时间待定');
});
test('manager season lists every official round in order, independent of FDR window', () => {
  const s = snapshot();
  s.leagueSchedule.reverse();
  const season = fx.managerSeason(s,22);
  assert.deepEqual(season.map(row=>row.match.gw),[3,4,5,6,7,8,9,10,38]);
  assert.ok(season.every(row=>row.name==='A'));
  assert.equal(fx.model(s,4,6).gws.length,6);
  assert.equal(fx.managerSeason(s,999).length,0);
});
test('page order is matchups, manager season, FDR; removed intro stays absent', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.ok(html.indexOf('id="fxMatchPanel"') < html.indexOf('id="fxManagerPanel"'));
  assert.ok(html.indexOf('id="fxManagerPanel"') < html.indexOf('id="fxTable"'));
  assert.doesNotMatch(html,/下一轮遇见谁，未来几轮怎么走/);
  assert.match(html,/fixtures\.js\?v=95/);
  assert.match(html,/fixtures\.css\?v=95/);
  assert.doesNotMatch(html, /<select[^>]+id="fxManager"/);
  assert.match(html, /id="fxManagerChoices"[^>]+role="group"/);
});
test('both matchup sides display their own current rank, never a fabricated rank', () => {
  const s = snapshot(), managers = new Map(s.managers.map(m => [m.entryId, m]));
  assert.match(fx.matchTeam(s.leagueSchedule[0], 1, managers, 'all'), /当前 #2/);
  assert.match(fx.matchTeam(s.leagueSchedule[0], 2, managers, 'all'), /当前 #1/);
  assert.match(fx.matchTeam({...s.leagueSchedule[0], entry2Id: null}, 2, managers, 'all'), /排名暂无/);
  for (const rank of [null, undefined, 0, -1, NaN]) assert.equal(fx.rankText({rank}), '排名暂无');
});
test('manager tiles keep an explicit selected state and escape names', () => {
  const managers = [{entryId:11, rank:2, entryName:'<A>', playerName:'M&N'}, {entryId:22, rank:1, entryName:'B'}];
  const html = fx.managerChoices(managers, '11');
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length, 1);
  assert.match(html, /data-manager="11" aria-pressed="true"/);
  assert.match(html, /&lt;A&gt;/);
  assert.match(html, /M&amp;N/);
  assert.match(html, /当前 #2/);
});
test('manager memory is league-specific and tolerates stale IDs or unavailable storage', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const a = snapshot(), b = snapshot(); a.meta.leagueId = 1; b.meta.leagueId = 2;
  fx.saveManager(a, '22', storage); fx.saveManager(b, '11', storage);
  assert.equal(fx.savedManager(a, storage), '22'); assert.equal(fx.savedManager(b, storage), '11');
  assert.equal(fx.savedManager({...a, managers:[{entryId:11}]}, storage), 'all');
  fx.saveManager(a, '999', storage); assert.equal(fx.savedManager(a, storage), '22');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(fx.savedManager(a, blocked), 'all'); assert.doesNotThrow(() => fx.saveManager(a, '11', blocked));
});

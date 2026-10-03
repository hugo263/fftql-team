'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '../public');
const read = name => fs.readFileSync(path.join(publicDir, name), 'utf8');
const source = read('match-centre.js');
const html = read('discover.html');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('event ownership joins stable codes, never raw IDs; grouped text and image shares carry each owner',async()=>{
  const initial=snapshot();initial.fixtures[0].home.short_name='ARS';
  initial.events=[{...initial.events[0],id:'g',kind:'goal',points:5,player:{id:10,code:10010,name:'Scorer',team:2}},
    {...initial.events[0],id:'a',kind:'assist',points:3,player:{id:11,code:10011,name:'Helper',team:2}}];
  const h=harness({initial,search:'?league=47275'});await flush();
  const league={meta:{leagueId:47275,leagueName:'我的联赛'},managers:[{entryId:500,leagueEntryId:123,entryName:'Manager One'}],
    players:[{id:10,photo:'99999',owner:null},{id:900,photo:'10010',owner:500},{id:901,photo:'10011',owner:null}]};
  h.controller.setLeagueSnapshot(league);
  assert.match(h.element('feed').innerHTML,/event-owner-tag is-owned"[^>]*>Manager One<\/span>/);
  assert.match(h.element('feed').innerHTML,/event-owner-tag is-free"[^>]*>自由球员<\/span>/);
  assert.match(h.element('ownershipNote').textContent,/我的联赛.*当前/);
  h.dispatch('feed','click','[data-text-share]',{textShare:'g'});await flush();
  assert.equal(h.copied[0],'Scorer (ARS) · Manager One ⚽ +5\nHelper (ARS) · 自由球员 👟 +3\nhttps://fftql.team');
  h.dispatch('feed','click','[data-share]',{share:'g'});
  assert.deepEqual(h.shares.at(-1).events.map(e=>e.title),['Scorer (ARS) · Manager One','Helper (ARS) · 自由球员']);
  league.players[1].owner=null;league.meta.stale=true;h.controller.setLeagueSnapshot(league);
  assert.match(h.element('feed').innerHTML,/event-owner-tag is-free"[^>]*>自由球员<\/span>/);assert.match(h.element('ownershipNote').textContent,/上次成功同步/);
  h.controller.setLeagueSnapshot({...league,meta:{leagueId:999}});
  assert.doesNotMatch(h.element('feed').innerHTML,/Manager One|自由球员/);assert.match(h.element('feed').innerHTML,/归属待确认/);
});

test('unmatched identity, missing owner and unknown manager never become free agents; owner text is escaped',async()=>{
  const initial=snapshot();initial.events=Array.from({length:5},(_,i)=>({...initial.events[0],id:'p'+i,player:{id:100+i,code:1000+i,name:'Player'+i,team:2}}));
  const h=harness({initial});await flush();
  const league={meta:{leagueId:47275},managers:[{entryId:5,entryName:'<script>owner</script>'}],players:[
    {id:100,photo:'1000',owner:5},{id:101,photo:'1001'}, {id:102,photo:'1002',owner:999}, {id:103,photo:'1003',owner:null}, {id:999,photo:'1003',owner:5}]};
  h.controller.setLeagueSnapshot(league);
  assert.match(h.element('feed').innerHTML,/&lt;script&gt;owner&lt;\/script&gt;/);
  assert.match(h.element('feed').innerHTML,/<span class="event-owner-tag is-owned"[^>]*>&lt;script&gt;owner&lt;\/script&gt;<\/span>/);
  assert.match(h.element('feed').innerHTML,/<span class="event-owner-tag is-unknown"[^>]*>归属待确认<\/span>/);
  assert.doesNotMatch(h.element('feed').innerHTML,/<script>|自由球员/);
  for(let i=1;i<5;i++)assert.ok(h.element('feed').innerHTML.includes('Player'+i+'</span>'));
});

test('manager badges wrap long names and use separate neutral colors for free and unknown ownership',()=>{
  const css=read('match-centre-layout.css');
  assert.match(css,/\.event-owner-tag\{[^}]*overflow-wrap:anywhere/);
  assert.match(css,/\.event-owner-tag\{[^}]*background:#e5efdf/);
  assert.match(css,/\.event-owner-tag\.is-free\{[^}]*background:#eef0ed/);
  assert.match(css,/\.event-owner-tag\.is-unknown\{[^}]*border-style:dashed/);
});

test('all clubs including Chelsea use official badges mapped by stable team code, not seasonal ID', async () => {
  const initial = snapshot();
  Object.assign(initial.fixtures[0].home, { id: 6, short_name: 'CHE', code: 8 });
  Object.assign(initial.fixtures[0].away, { id: 1, short_name: 'ARS', code: 3 });
  const h = harness({initial}); await flush();
  const rendered = h.element('matches').innerHTML;
  assert.match(rendered, /badges\/70\/t8\.png/);
  assert.match(rendered, /badges\/70\/t3\.png/);
  assert.doesNotMatch(rendered, /badges\/70\/t6\.png|badges\/70\/t1\.png|chelsea-bus|非官方简化图标/);
  assert.doesNotMatch(source, /const markPaths|const clubMarks/);
  assert.ok(fs.statSync(path.join(publicDir,'brand/chelsea-bus-v74.png')).size > 0);
});

test('unknown or unsafe team codes use an escaped abbreviation rather than a guessed badge URL', async () => {
  const initial = snapshot();
  Object.assign(initial.fixtures[0].home, { short_name: '<ARS>', code: '../8' });
  Object.assign(initial.fixtures[0].away, { short_name: 'FPL', code: 0 });
  const h = harness({initial}); await flush();
  const rendered = h.element('matches').innerHTML;
  assert.match(rendered, /crest--fallback/);
  assert.match(rendered, /&lt;ARS&gt;/);
  assert.doesNotMatch(rendered, /badges\/70\//);
});

test('official badge style preserves the complete outline without the former bus zoom or rounded crop', () => {
  const css = read('match-centre-layout.css');
  assert.match(css, /\.crest--official\{[^}]*border-radius:0[^}]*overflow:visible/);
  assert.match(css, /\.crest--official img\{[^}]*object-fit:contain[^}]*transform:none/);
  assert.doesNotMatch(css, /transform:scale\(1\.2\)/);
  assert.match(html, /队徽使用 FPL 官方图片资源/);
});

test('failed official images become readable abbreviations and remain a fallback on data refresh', async () => {
  const initial = snapshot(); Object.assign(initial.fixtures[0].home, { code: 8, short_name: 'CHE' });
  const h = harness({initial}); await flush();
  const holder = {};
  const image = { matches: selector => selector === 'img[data-club-badge]',
    dataset: { clubBadge: '8', clubShort: 'CHE' }, closest: () => holder };
  h.fireBadgeError(image);
  assert.equal(holder.className, 'crest crest--fallback'); assert.equal(holder.textContent, 'CHE');
  initial.fixtures[0].team_h_score = 1;
  initial.meta.updated = '2026-09-12T15:02:00Z'; h.setReply(initial); await h.refresh();
  assert.doesNotMatch(h.element('matches').innerHTML, /badges\/70\/t8\.png/);
  assert.match(h.element('matches').innerHTML, /crest--fallback[^>]*>CHE<\/span>/);
});

test('progress layout puts feed first, splits desktop equally and scrolls both columns with the document', () => {
  assert.ok(html.indexOf('<section class="panel events-panel"') < html.indexOf('<aside class="score-column"'));
  const css = read('match-centre-layout.css');
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.score-pair\{display:flex/);
  assert.match(css, /\.score-column\{position:static\}/);
  assert.doesNotMatch(css,/\.score-column\{position:sticky/);
  assert.match(css, /\.team-red-card i\{/);
  assert.match(html, /id="shareTitle">比赛进展/);
  assert.doesNotMatch(html + source, /这一刻，值得聊聊|把这一刻，发到群里/);
});

test('goal and assist combine only within the same fixture, team and update batch, retaining individual points', async()=>{
  const initial=snapshot(), template=initial.events[0];
  initial.fixtures[0].home.short_name='ARS';
  initial.events=[
    {...template,id:'goal',baseline:false,points:5,delta:1,player:{name:'Scorer',team:2}},
    {...template,id:'assist',kind:'assist',baseline:false,points:3,delta:1,player:{name:'Helper',team:2}},
    {...template,id:'opponent',kind:'assist',baseline:false,points:3,delta:1,player:{name:'Opponent',team:3}},
    {...template,id:'later',kind:'assist',baseline:false,observedAt:'2026-09-12T14:56:00Z',points:3,player:{name:'Later',team:2}},
  ];
  const h=harness({initial});await flush();
  h.dispatch('feed','click','[data-share]',{share:'goal'});
  const result=h.shares.at(-1);
  assert.equal(result.compact,true);
  assert.deepEqual(result.events.map(e=>[e.title,e.points]),[['Scorer (ARS) · 归属待确认','+5'],['Helper (ARS) · 归属待确认','+3']]);
  assert.match(h.element('feed').innerHTML,/不代表逐球配对/);
  assert.match(h.element('feed').innerHTML,/data-share="opponent"/);
  assert.match(h.element('feed').innerHTML,/data-share="later"/);
});

test('text share copies only player, team abbreviation, emoji, signed points and one website URL',async()=>{
  const initial=snapshot();initial.fixtures[0].home.short_name='ARS';
  initial.events=[{...initial.events[0],id:'text',points:5,player:{name:'Scorer',team:2}}];
  const h=harness({initial});await flush();
  h.dispatch('feed','click','[data-text-share]',{textShare:'text'});await flush();
  assert.deepEqual(h.copied,['Scorer (ARS) · 归属待确认 ⚽ +5\nhttps://fftql.team']);
  assert.equal(h.prompts.length,0);
  const denied=harness({initial,clipboardFails:true});await flush();
  denied.dispatch('feed','click','[data-text-share]',{textShare:'text'});await flush();
  assert.equal(denied.copied.length,0);assert.equal(denied.prompts[0][1],h.copied[0]);
});

test('default feed excludes all other events, explicit other filter contains DC, bonus and both penalty kinds',async()=>{
  const initial=snapshot();
  initial.events.push(...['dc','bonus','penalty_saved','penalty_missed'].map((kind,index)=>({...initial.events[0],kind,id:kind,points:index===3?-2:2,player:{name:'Other'+index,team:2}})));
  const h=harness({initial});await flush();
  assert.doesNotMatch(h.element('feed').innerHTML,/Other[0-3]/);
  h.dispatch('.event-filters','click','[data-event-filter]',{eventFilter:'other'});
  for(let i=0;i<4;i++)assert.match(h.element('feed').innerHTML,new RegExp('Other'+i));
  assert.doesNotMatch(h.element('feed').innerHTML,/Pending Player|Booked Player/);
  assert.doesNotMatch(h.element('feed').innerHTML,/罚丢点球修订/);
});

test('timeline is newest detection first, never grouped by event kind; tied events retain source order', async () => {
  const initial = snapshot();
  initial.events = [
    { ...initial.events[0], id:'old-goal',baseline:false,observedAt:'2026-09-12T14:53:00Z',player:{name:'OlderGoal'} },
    { ...initial.events[2], id:'new-card',observedAt:'2026-09-12T14:59:00Z',player:{name:'NewestCard'} },
    { ...initial.events[0], id:'same-time-goal',baseline:false,observedAt:'2026-09-12T14:59:00Z',player:{name:'SameBatchGoal'} },
    { ...initial.events[0], id:'baseline',observedAt:'2026-09-12T15:00:00Z',player:{name:'BaselineGoal'} },
  ];
  const h=harness({initial}); await flush();
  const feed=h.element('feed').innerHTML;
  assert.ok(feed.indexOf('NewestCard') < feed.indexOf('SameBatchGoal'));
  assert.ok(feed.indexOf('SameBatchGoal') < feed.indexOf('OlderGoal'));
  assert.ok(feed.indexOf('OlderGoal') < feed.indexOf('BaselineGoal'));
  assert.match(feed,/首次同步摘要/);
  assert.match(feed,/无法还原发生先后/);
  assert.match(feed,/aria-label="黄牌"><svg/);
});

test('fixture red cards use the authoritative current count and disappear on correction', async () => {
  const initial=snapshot();initial.fixtures[0].redCards={home:2,away:0};
  const h=harness({initial});await flush();
  assert.match(h.element('matches').innerHTML,/aria-label="2 张红牌"/);
  assert.equal((h.element('matches').innerHTML.match(/class="team-red-card"/g)||[]).length,1);
  initial.fixtures[0].redCards.home=0;h.setReply(initial);await h.refresh();
  assert.doesNotMatch(h.element('matches').innerHTML,/class="team-red-card"/);
});

test('other filter exposes bonus while default all excludes it', async () => {
  const initial=snapshot();initial.events.push({...initial.events[0],id:'bonus',kind:'bonus',value:3,points:3,player:{name:'BonusPlayer'}});
  const h=harness({initial});await flush();
  assert.doesNotMatch(h.element('feed').innerHTML,/BonusPlayer/);
  h.dispatch('.event-filters','click','[data-event-filter]',{eventFilter:'other'});
  assert.match(h.element('feed').innerHTML,/BonusPlayer/);
  assert.doesNotMatch(h.element('feed').innerHTML,/Pending Player|Booked Player/);
  h.dispatch('shareRound');
  assert.equal(h.shares.at(-1).title,'比赛进展');
  assert.equal(h.shares.at(-1).events[0].tag,'⭐');
});

function snapshot() {
  const fixture = (id, kickoff, extra = {}) => ({
    id, kickoff_time: kickoff, started: false, finished: false, finished_provisional: false,
    minutes: 0, team_h_score: null, team_a_score: null,
    home: { id: id * 2, short_name: `HOME${id}`, name: `Home ${id}` },
    away: { id: id * 2 + 1, short_name: `AWAY${id}`, name: `Away ${id}` }, ...extra
  });
  return {
    meta: { gw: 4, updated: '2026-09-12T15:00:00.000Z', stale: false,
      finished: false, data_checked: false, settled: true },
    gameweeks: [{ id: 3 }, { id: 4 }, { id: 5 }],
    fixtures: [
      fixture(1, '2026-09-12T14:00:00Z', { started: true, minutes: 60, team_h_score: 0, team_a_score: 1 }),
      fixture(2, '2026-09-12T16:30:00Z', { team_h_score: 0, team_a_score: 0 }),
      fixture(3, null),
      fixture(4, '2026-09-12T12:00:00Z', { started: true, finished_provisional: true, team_h_score: 2, team_a_score: 0 })
    ],
    events: [
      { id: 'pending', fixtureId: 1, kind: 'goal', baseline: true, value: 1, points: null,
        player: { name: 'Pending Player', team: 2, position: 'FWD' }, observedAt: '2026-09-12T14:55:00Z' },
      { id: 'next-day', fixtureId: 2, kind: 'assist', baseline: false, value: 1, delta: 1, points: 3,
        player: { name: 'Next Day Player', team: 4, position: 'MID' }, observedAt: '2026-09-12T14:58:00Z' },
      { id: 'card', fixtureId: 1, kind: 'yellow', baseline: false, value: 1, delta: 1, points: -1,
        player: { name: 'Booked Player', team: 2, position: 'DEF' }, observedAt: '2026-09-12T14:57:00Z' }
    ]
  };
}

// Run the complete shipped script against a minimal DOM; the fixture data above
// is confined to tests and cannot become a production fallback.
function harness({ initial = snapshot(), search = '', storageFails = false, clipboardFails = false } = {}) {
  const nodes = new Map(), intervals = [], timers = [], requests = [], shares = [], stored = new Map(), documentListeners = new Map();
  const copied = [], prompts = [];
  let reply = initial;
  let time = Date.parse('2026-09-12T15:00:00.000Z');
  let initializing = true;
  class TestDate extends Date { static now() { return time; } }
  function element(id) {
    if (!nodes.has(id)) {
      const classes = new Set(), listeners = new Map();
      const node = { id, dataset: {}, innerHTML: '', textContent: '', value: '', hidden: false,
        disabled: false, attributes: {}, listeners,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name),
          toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        addEventListener(name, callback) { listeners.set(name, callback); },
        setCustomValidity(message) { this.validationMessage = message; },
        reportValidity() { this.reported = true; }, scrollIntoView() {}, focus() { this.focused = true; },
        showModal() { this.open = true; }, close() { this.open = false; }
      };
      node.parentElement = { classList: node.classList, dataset: {}, setAttribute() {} };
      nodes.set(id, node);
    }
    return nodes.get(id);
  }
  const document = {
    visibilityState: 'visible', getElementById: id => initializing && id === 'matches' ? null : element(id),
    querySelector: element, querySelectorAll: () => [],
    addEventListener: (name, callback) => documentListeners.set(name, callback)
  };
  const context = vm.createContext({ document, location: { search }, URL, URLSearchParams, Intl, Date:TestDate, AbortSignal,
    window: { TQLShare: { open: input => shares.push(JSON.parse(JSON.stringify(input))) }, prompt: (...args)=>prompts.push(args) },
    navigator: { clipboard: { writeText: async value=>{if(clipboardFails)throw Error('denied');copied.push(value);} } },
    setTimeout:(callback,ms)=>{timers.push({callback,ms,due:time+ms,cancelled:false});return timers.length;},
    clearTimeout:id=>{if(timers[id-1])timers[id-1].cancelled=true;},
    localStorage: {
      getItem: key => { if (storageFails) throw Error('Storage denied'); return stored.get(key) || null; },
      setItem: (key, value) => { if (storageFails) throw Error('Storage denied'); stored.set(key, value); }
    },
    matchMedia: () => ({ matches: false }),
    fetch: async (url, options) => {
      requests.push({ url, options });
      const value = typeof reply === 'function' ? await reply() : reply;
      if (value instanceof Error) throw value;
      return { ok: true, json: async () => JSON.parse(JSON.stringify(value)) };
    },
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); }
  });
  vm.runInContext(source, context);
  initializing = false;
  const controller = context.window.TQLMatchCentre.mount(document);
  function dispatch(id, type = 'click', selector = null, dataset = {}) {
    const event = { prevented: false, preventDefault() { this.prevented = true; },
      target: { closest: candidate => candidate === selector ? { dataset } : null } };
    const result = element(id).listeners.get(type)?.(event);
    return { event, result };
  }
  return { element, requests, shares, copied, prompts, intervals, timers, stored, document, dispatch, controller,
    fireBadgeError: image => documentListeners.get('error')?.({target:image}),
    advance: ms => { time += ms; },
    tick: async ms => {time+=ms;for(const timer of timers.filter(timer=>!timer.cancelled && timer.due<=time)){timer.cancelled=true;timer.callback();}await flush();},
    setReply: value => { reply = value; },
    refresh: async () => { await dispatch('refreshData').result; await flush(); },
    visibility: async state => { document.visibilityState = state; documentListeners.get('visibilitychange')?.(); await flush(); }
  };
}

test('match centre entry loads only versioned production assets and retains league help, feedback and private admin boundary', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['/night-share.js?v=98', '/match-centre-share.js?v=105', '/update-stream.js?v=79', '/live-render.js?v=79', '/match-centre.js?v=105', '/analytics.js?v=98']);
  for (const url of [...scripts, '/match-centre.css?v=63']) {
    assert.ok(fs.statSync(path.join(publicDir, url.split('?')[0])).isFile());
  }
  assert.doesNotMatch(html, /(?:src|href)="\/(?:discover\.(?:css|js)|app\.js|admin(?:[/?#"]))/);
  for (const id of ['gwSelect', 'dayChoices', 'previousDay', 'nextDay', 'leagueForm', 'leagueId',
    'guideDialog', 'feedbackDialog', 'showFeedback', 'dataNotice', 'shareDialog', 'updateAnnouncement']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.match(html, /action="\/" method="get"/);
  assert.match(html, /name="league"/);
  assert.match(html, /https:\/\/draft\.premierleague\.com\//);
  assert.match(html, /\/league\/47275\/edit/);
  assert.match(html, /\/api\/league\/数字\/details/);
  assert.match(html, /\/wechat-feedback\.jpg\?v=35/);
  assert.match(html, /检测时间不是发生时间/);
  assert.match(html, /首次同步.*累计/);
  assert.doesNotMatch(source, /(?:const|let)\s+(?:demoData|mockData)\s*=/);
});

test('official endpoint renders unknown fixture scores and pending points without fabricated zeros', async () => {
  const h = harness(); await flush();
  assert.equal(h.requests[0].url, '/api/match-centre');
  assert.equal(h.requests[0].options.cache, 'no-store');
  assert.ok(h.requests[0].options.signal);
  assert.match(h.element('matches').innerHTML, /Home 1 vs Away 1，60′，0 比 1/);
  assert.match(h.element('matches').innerHTML, /Home 2 vs Away 2，00:30，— 比 —/);
  assert.match(h.element('matches').innerHTML, /Home 3 vs Away 3，待定，— 比 —/);
  assert.equal(h.element('liveFilterCount').textContent, 1, 'provisional full time is not live');
  assert.match(h.element('feed').innerHTML, /待同步 分/);
  assert.match(h.element('feed').innerHTML, /尚待同步，不以 0 分代替/);
  assert.doesNotMatch(h.element('feed').innerHTML, /FPL 已结算/, 'authoritative unfinished flags override supplied settled:true');
});

test('scores prioritize live then chronological upcoming with completed fixtures collapsed at the bottom', async () => {
  const initial=snapshot();initial.fixtures.reverse();
  const originalIds=initial.fixtures.map(m=>m.id);
  const h=harness({initial});await flush();
  const rendered=h.element('matches').innerHTML;
  assert.ok(rendered.indexOf('Home 1')<rendered.indexOf('Home 2'));
  assert.ok(rendered.indexOf('Home 2')<rendered.indexOf('Home 3'));
  assert.ok(rendered.indexOf('Home 3')<rendered.indexOf('Home 4'));
  assert.match(rendered,/id="completedMatches" hidden/);
  assert.match(rendered,/data-completed-toggle aria-expanded="false"/);
  assert.deepEqual(initial.fixtures.map(m=>m.id),originalIds);
  const feed=h.element('feed').innerHTML;
  h.dispatch('matches','click','[data-completed-toggle]');
  assert.match(h.element('matches').innerHTML,/data-completed-toggle aria-expanded="true"/);
  assert.doesNotMatch(h.element('matches').innerHTML,/id="completedMatches" hidden/);
  assert.equal(h.element('feed').innerHTML,feed,'folding scores must not filter the event feed');
  assert(h.element('toggleCompletedMatches').focused);
  await h.refresh();assert.match(h.element('matches').innerHTML,/aria-expanded="true"/);
  h.dispatch('matches','click','[data-completed-toggle]');assert.match(h.element('matches').innerHTML,/id="completedMatches" hidden/);
});

test('live completion moves into the completed group; a new GW resets collapse state', async () => {
  const h=harness();await flush();
  h.dispatch('matches','click','[data-completed-toggle]');
  const next=snapshot();next.fixtures[0].finished_provisional=true;h.setReply(next);await h.refresh();
  const rendered=h.element('matches').innerHTML;
  assert.ok(rendered.indexOf('Home 2')<rendered.indexOf('Home 1'));
  assert.doesNotMatch(rendered,/score-group-live/);
  assert.match(rendered,/aria-expanded="true"/);
  next.meta.gw=5;h.setReply(next);await h.refresh();
  assert.match(h.element('matches').innerHTML,/id="completedMatches" hidden/);
  h.dispatch('.score-tools','click','[data-match-filter]',{matchFilter:'live'});
  assert.match(h.element('matches').innerHTML,/暂无正在进行的比赛/);
  assert.doesNotMatch(h.element('matches').innerHTML,/completedMatches/);
});

test('a fully finished GW has an expandable results section, not an empty schedule', async () => {
  const initial=snapshot();initial.fixtures.forEach(m=>{m.started=true;m.finished=true;});
  const h=harness({initial});await flush();
  assert.match(h.element('matches').innerHTML,/已完赛 <small>4 场/);
  assert.doesNotMatch(h.element('matches').innerHTML,/empty-state|score-group-live|score-group-upcoming/);
  h.dispatch('matches','click','[data-completed-toggle]');
  assert.doesNotMatch(h.element('matches').innerHTML,/id="completedMatches" hidden/);
});

test('Beijing date choices scope both fixtures and events, including unknown kickoff dates', async () => {
  const h = harness(); await flush();
  assert.match(h.element('dayChoices').innerHTML, /data-day="2026-09-13"/);
  assert.match(h.element('dayChoices').innerHTML, /data-day="tbd"/);
  h.dispatch('dayChoices', 'click', '[data-day]', { day: '2026-09-13' });
  assert.match(h.element('matches').innerHTML, /Home 2/);
  assert.doesNotMatch(h.element('matches').innerHTML, /Home 1|Home 4/);
  assert.match(h.element('feed').innerHTML, /Next Day Player/);
  assert.doesNotMatch(h.element('feed').innerHTML, /Pending Player|Booked Player/);
  h.dispatch('nextDay');
  assert.equal(h.element('scopeText').textContent, '开球时间待定');
  assert.match(h.element('matches').innerHTML, /Home 3/);
  assert.equal(h.element('nextDay').disabled, true);
});

test('same-GW refresh preserves date and event filter, while selected gameweek is requested explicitly', async () => {
  const h = harness(); await flush();
  h.dispatch('dayChoices', 'click', '[data-day]', { day: '2026-09-12' });
  h.dispatch('.event-filters', 'click', '[data-event-filter]', { eventFilter: 'cards' });
  const next = snapshot(); next.meta.updated = '2026-09-12T15:01:00Z';
  next.fixtures[0].team_h_score = 2; h.setReply(next); await h.refresh();
  assert.match(h.element('matches').innerHTML, /2 比 1/);
  assert.doesNotMatch(h.element('matches').innerHTML, /Home 2/);
  assert.match(h.element('feed').innerHTML, /Booked Player/);
  assert.doesNotMatch(h.element('feed').innerHTML, /Pending Player/);
  h.element('gwSelect').value = '3';
  h.dispatch('gwSelect', 'change'); await flush();
  assert.equal(h.requests.at(-1).url, '/api/match-centre?gw=3');
});

test('deadline-based fallback pauses while hidden, resumes with a cache read and coalesces overlapping refreshes', async () => {
  const h = harness(); await flush();
  assert.equal(h.intervals.length, 0, 'no independent interval polling loop');
  await h.visibility('hidden'); await h.tick(60000);
  assert.equal(h.requests.length, 1);
  await h.visibility('visible'); assert.equal(h.requests.length, 2);
  let resolve;
  h.setReply(() => new Promise(done => { resolve = done; }));
  h.dispatch('refreshData'); h.dispatch('refreshData'); await h.tick(60000);
  assert.equal(h.requests.length, 3, 'one in-flight refresh despite three triggers');
  assert.equal(h.element('refreshData').disabled, true);
  resolve(snapshot()); await flush();
  assert.equal(h.element('refreshData').disabled, false);
});

test('idle clock ticks do not poll before three hours; reopening reads shared cache immediately', async () => {
  const initial=snapshot();initial.meta.refreshMode='idle';initial.meta.refreshSeconds=10800;
  initial.meta.nextRefreshAt='2026-09-12T18:00:00.000Z';
  const h=harness({initial});await flush();
  assert.match(h.element('.source-label').textContent,/3 小时/);
  for(let i=0;i<179;i++)await h.tick(60000);
  assert.equal(h.requests.length,1);
  await h.visibility('hidden');await h.visibility('visible');
  assert.equal(h.requests.length,2);
  await h.tick(60000);
  assert.equal(h.requests.length,3);
});

test('idle browser follows the early kickoff wake-up rather than waiting three hours', async () => {
  const initial=snapshot();initial.meta.refreshMode='idle';initial.meta.refreshSeconds=10800;
  initial.meta.nextRefreshAt='2026-09-12T15:09:00.000Z';
  const h=harness({initial});await flush();
  await h.tick(8*60000);assert.equal(h.requests.length,1);
  await h.tick(60000);assert.equal(h.requests.length,2);
});

test('fetch failure preserves previous scores and source timestamp and shares them as stale', async () => {
  const h = harness(); await flush();
  const before = h.element('matches').innerHTML;
  h.setReply(new Error('Upstream unavailable')); await h.refresh();
  assert.equal(h.element('matches').innerHTML, before);
  assert.match(h.element('dataNotice').textContent, /保留原有比分与更新时间/);
  assert.match(h.element('snapshotTime').textContent, /数据延迟.*23:00:00/);
  h.dispatch('shareRound');
  assert.equal(h.shares.at(-1).meta.updated, '2026-09-12T15:00:00.000Z');
  assert.equal(h.shares.at(-1).meta.stale, true);
  assert.equal(h.shares.at(-1).meta.demo, false);
});

test('first-load failure has explicit empty states, no invented score and no share payload', async () => {
  const h = harness({ initial: new Error('Unavailable') }); await flush();
  assert.match(h.element('matches').innerHTML, /赛程暂未加载/);
  assert.match(h.element('feed').innerHTML, /尚未获取到官方事件数据/);
  assert.match(h.element('dataNotice').textContent, /不会以零分代替缺失数据/);
  h.dispatch('shareRound'); assert.equal(h.shares.length, 0);
});

test('league lookup accepts positive IDs and exact official Draft links while rejecting lookalike hosts', async () => {
  const h = harness({ storageFails: true }); await flush();
  for (const [input, normalized] of [['47275', '47275'], ['00012', '12'],
    ['https://draft.premierleague.com/league/47275/edit', '47275'],
    ['https://draft.premierleague.com/api/league/47275/details', '47275']]) {
    h.element('leagueId').value = input;
    const { event } = h.dispatch('leagueForm', 'submit');
    assert.equal(event.prevented, false, input);
    assert.equal(h.element('leagueId').value, normalized);
  }
  for (const input of ['0', '000', '-1', '1.5', '1e4', '12345678901',
    'https://draft.premierleague.com.evil.example/league/47275/',
    'https://evil.example/league/47275/', 'javascript:alert(1)']) {
    h.element('leagueId').value = input;
    assert.equal(h.dispatch('leagueForm', 'submit').event.prevented, true, input);
    assert.match(h.element('leagueId').validationMessage, /有效联赛/);
  }
  h.dispatch('leagueId', 'input'); assert.equal(h.element('leagueId').validationMessage, '');
  h.dispatch('showLeagueGuide'); assert.equal(h.element('guideDialog').open, true);
  h.dispatch('showFeedback'); assert.equal(h.element('feedbackDialog').open, true);
});

test('share payload preserves complete filtered count, source time, pending points and detection labels', async () => {
  const initial = snapshot();
  initial.events = Array.from({ length: 7 }, (_, index) => ({ ...initial.events[0],
    id: `event-${index}`, baseline: index === 0, observedAt: `2026-09-12T14:5${index}:00Z`,
    player: { name: `Player ${index}`, team: 2, position: 'FWD' } }));
  const h = harness({ initial }); await flush();
  h.dispatch('matches', 'click', '[data-match]', { match: '1' });
  h.dispatch('shareRound');
  const card = h.shares[0];
  assert.equal(card.events.length, 7, 'renderer needs the complete selection to report omitted events accurately');
  assert.equal(card.meta.updated, initial.meta.updated);
  assert.equal(card.meta.settled, false);
  assert.equal(card.score.homeScore, '0');
  assert.equal(card.events.at(-1).time, '本场累计');
  assert.ok(card.events.slice(0, -1).every(event => /检测/.test(event.time)));
  assert.ok(card.events.every(event => event.points === '待同步'));
  h.dispatch('feed', 'click', '[data-share]', { share: 'event-3' });
  assert.equal(h.shares.at(-1).events.length, 1);
  assert.equal(h.shares.at(-1).meta.updated, initial.meta.updated);
});

test('official player and team strings are escaped in rendered HTML and event attributes', async () => {
  const initial = snapshot();
  initial.fixtures[0].home.name = '<img src=x onerror=alert(1)>';
  initial.events[0].player.name = '<script>alert(1)</script>';
  initial.events[0].id = '" onclick="alert(1)';
  const h = harness({ initial }); await flush();
  assert.doesNotMatch(h.element('matches').innerHTML, /<img src=x/);
  assert.match(h.element('matches').innerHTML, /&lt;img/);
  assert.doesNotMatch(h.element('feed').innerHTML, /<script>|data-share="" onclick=/);
  assert.match(h.element('feed').innerHTML, /&lt;script&gt;/);
  assert.match(h.element('feed').innerHTML, /&quot; onclick=&quot;/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('opening fixtures only renders that module; unchanged switches are reused and new data invalidates them', () => {
  const calls = [];
  const sandbox = {STATE:{snap:{meta:{}}}, updateTradeCountdowns:()=>{}, FPLFixtures:{render:()=>calls.push('fixtures')}};
  for (const name of ['renderWeekly','renderTradeCenter','renderStandings','renderFreeAgentTeamOptions','renderFreeAgents','initShare','initCompare','renderPredict','initTrade']) sandbox[name]=()=>calls.push(name);
  vm.createContext(sandbox);
  vm.runInContext(app.slice(app.indexOf('const tabSnapshots ='), app.indexOf('function renderAll()')),sandbox);
  sandbox.renderTab('fixtures'); sandbox.renderTab('fixtures');
  assert.deepEqual(calls,['fixtures']);
  sandbox.renderTab('share'); sandbox.renderTab('fixtures');
  assert.deepEqual(calls,['fixtures','initShare']);
  sandbox.STATE.snap={meta:{}}; sandbox.renderTab('fixtures');
  assert.deepEqual(calls,['fixtures','initShare','fixtures']);
  sandbox.renderTab('invalid'); assert.equal(calls.length,3);
});
test('head starts independent bounded home and league requests before resources; errors are retained for boot', async () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [query, expected] of [['?league=47275','/api/league/47275'],['?league=00012','/api/league/12'],['?league=x','/api/snapshot']]) {
    for (const hash of ['#fixtures', '#home', '']) {
      const calls=[];
      const context={URLSearchParams,location:{search:query,hash},document:{documentElement:{classList:{add(){}}}},window:{},
        AbortSignal:{timeout:ms=>({timeoutMs:ms})},
        fetch:async (url,options)=>{calls.push({url,signal:options.signal});return {ok:true,json:async()=>({meta:{leagueId:47275}})};}};
      vm.runInNewContext(script,context);
      assert.equal(calls.length,hash==='#fixtures'?1:2); assert.equal(calls[0].url,expected);
      assert.equal(calls[0].signal.timeoutMs,45000);
      assert.ok((await context.window.__fplInitialSnapshot).data.meta);
      if (hash!=='#fixtures') {
        assert.equal(calls[1].url,'/api/match-centre'); assert.equal(calls[1].signal.timeoutMs,30000);
        assert.ok((await context.window.__fplInitialMatchCentre).data.meta);
      } else assert.equal(context.window.__fplInitialMatchCentre,undefined);
    }
  }
  const context={URLSearchParams,AbortSignal:{timeout:ms=>({timeoutMs:ms})},location:{search:'',hash:'#home'},document:{},window:{},fetch:()=>Promise.reject(Error('offline'))};
  vm.runInNewContext(script,context);
  assert.equal((await context.window.__fplInitialSnapshot).error.message,'offline');
  assert.equal((await context.window.__fplInitialMatchCentre).error.message,'offline');
});
test('boot reuses early response and does not fetch the same snapshot twice', async () => {
  let rendered=0, requests=0, scheduled=0;
  const context={window:{__fplInitialSnapshot:Promise.resolve({data:{meta:{leagueId:47275}}})},
    STATE:{snap:null},snapshotGeneration:0,snapshotLoading:false,snapshotError:'',snapshotFailures:0,
    $:()=>({setAttribute(){}}),applySnapshot:snapshot=>{rendered++;context.STATE.snap=snapshot;},scheduleAutoRefresh:()=>scheduled++,
    readSnapshot:()=>{requests++;throw Error('Early snapshot must be reused');},fetch:()=>{requests++;throw Error('Unexpected duplicate fetch');}};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function boot()'),app.indexOf('// Hidden modules')),context);
  await context.boot();
  assert.equal(rendered,1); assert.equal(requests,0); assert.equal(scheduled,1);
  assert.equal(context.window.__fplInitialSnapshot,undefined);
  assert.equal(context.snapshotGeneration,1); assert.equal(context.snapshotLoading,false);
});

test('late initial fetch cannot overwrite a newer manually refreshed generation', async () => {
  let finish,rendered=0,scheduled=0;
  const context={window:{__fplInitialSnapshot:new Promise(resolve=>{finish=resolve;})},STATE:{snap:null},
    snapshotGeneration:0,snapshotLoading:false,snapshotError:'',snapshotFailures:0,
    applySnapshot:()=>rendered++,scheduleAutoRefresh:()=>scheduled++,$:()=>({setAttribute(){}})};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function boot()'),app.indexOf('// Hidden modules')),context);
  const pending=context.boot();
  context.snapshotGeneration++; context.snapshotLoading=false;
  const current={meta:{revision:'manual-newer'}};context.STATE.snap=current;
  finish({data:{meta:{revision:'initial-older'}}});await pending;
  assert.equal(rendered,0);assert.equal(scheduled,0);assert.equal(context.STATE.snap,current);
});

test('healthy push avoids polls, recovering reads back off, and hidden/offline tabs stop timers without changing source time', () => {
  const timers=new Map();let sequence=0,polls=0,healthy=false;
  const original={updated:'2026-09-14T12:00:00Z',reportSourceUpdated:'2026-09-14T11:59:30Z',refreshing:false};
  const context={autoRefreshTimer:null,document:{hidden:false},window:{navigator:{onLine:true}},
    STATE:{snap:{meta:{...original}}},leagueUpdates:{healthy:()=>healthy},snapshotFailures:0,
    setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    pollSnapshot:()=>polls++,updateRefreshStatus(){}};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function scheduleAutoRefresh()'),app.indexOf('async function readSnapshot(')),context);
  const next=()=>timers.get(context.autoRefreshTimer);
  context.scheduleAutoRefresh();assert.equal(next().ms,15000);next().fn();assert.equal(polls,1);
  healthy=true;context.scheduleAutoRefresh();next().fn();assert.equal(polls,1);
  context.STATE.snap.meta.refreshing=true;context.scheduleAutoRefresh();assert.equal(next().ms,7500);next().fn();assert.equal(polls,2);
  context.STATE.snap.meta.refreshing=false;
  for (const [failures,delay] of [[1,30000],[2,60000],[10,60000]]) {
    context.snapshotFailures=failures;context.scheduleAutoRefresh();assert.equal(next().ms,delay);
  }
  context.document.hidden=true;context.scheduleAutoRefresh();assert.equal(timers.size,0);
  context.document.hidden=false;context.window.navigator.onLine=false;context.scheduleAutoRefresh();assert.equal(timers.size,0);
  assert.deepEqual(context.STATE.snap.meta,original);
  assert.match(app,/正在同步最新数据，当前先展示上次结果/);
  assert.match(html,/id="snapshotSyncNotice"[^>]*role="status" hidden/);
  const render=app.slice(app.indexOf('function renderAll()'),app.indexOf('/* ---------------- tabs'));
  assert.doesNotMatch(render,/requestedButton\.click|initShare\(\)|initCompare\(\)|renderPredict\(\)/);
  assert.match(render,/renderTab\(/);
});

test('hash module selection happens before analytics and never creates synthetic clicks', () => {
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script=scripts.find(item=>item[1].includes('Resolve the initial module'));
  assert.ok(script.index < html.indexOf('src="/analytics.js'));
  const tabs=['weekly','fixtures','share'].map(tab=>({dataset:{tab},classList:{toggle(_name,value){this.active=value;}}}));
  const panels=tabs.map(tab=>({id:`tab-${tab.dataset.tab}`,classList:{toggle(_name,value){this.active=value;}}}));
  vm.runInNewContext(script[1],{location:{hash:'#fixtures'},document:{querySelectorAll:selector=>selector==='#tabs .tab'?tabs:panels}});
  assert.deepEqual(tabs.map(tab=>tab.classList.active),[false,true,false]);
  assert.deepEqual(panels.map(panel=>panel.classList.active),[false,true,false]);
  assert.doesNotMatch(script[1],/\.click\(/);
});

test('default manager is resolved before rendering any lazily initialized module', () => {
  const apply=app.slice(app.indexOf('function applySnapshot'),app.indexOf('function scheduleAutoRefresh'));
  assert.ok(apply.indexOf('STATE.snap = snapshot') < apply.indexOf('getMyEntryId()'));
  assert.ok(apply.indexOf('getMyEntryId()') < apply.indexOf('renderAll()'));
});

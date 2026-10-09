'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('homepage is the first default tab while legacy league modules and deep links remain', () => {
  const html = read('public/index.html');
  const tabs = [...html.matchAll(/<button class="tab([^"]*)" data-tab="([^"]+)"/g)];
  assert.equal(tabs[0][2], 'home');
  assert.deepEqual(tabs.filter(tab => tab[1].includes('active')).map(tab => tab[2]), ['home']);
  assert.match(html, /id="tab-home" class="tabpanel active"/);
  assert.match(html, /data-portal-link aria-label="TQL FPL 主站首页"/);
  assert.equal((html.match(/<header id="top" class="night-site-head"/g) || []).length, 1);
  assert.equal((html.match(/\/analytics.js\?/g) || []).length, 1);
  assert.ok(html.includes('/home-tab.js?v=106'));
  assert.ok(html.indexOf('/home-tab.js?v=106') < html.indexOf('/app.js?v=105'));
  const ui = read('public/workspace-ui.js');
  assert.match(ui, /addEventListener\('hashchange'/);
  assert.match(ui, /aria-selected/);
});

test('home renders before league data is available and suspends when switching modules', () => {
  const app = read('public/app.js');
  const functionStart = app.indexOf('function renderTab(');
  const renderTab = app.slice(functionStart, app.indexOf('\nfunction renderAll(', functionStart));
  assert.ok(renderTab.includes("if (tab === 'home') return;"));
  const visible = [];
  const notice = { hidden: true, textContent: '' };
  let countdowns = 0;
  const context = vm.createContext({ STATE: { snap: null }, snapshotError: '', tabSnapshots: new Map(),
    $: selector => { assert.equal(selector, '#initialLoadNotice'); return notice; },
    window: { TQLHome: { show: value => visible.push(value) } },
    updateTradeCountdowns() { countdowns++; }, renderWeekly() { throw Error('A missing snapshot must not render league data'); } });
  vm.runInContext(`${renderTab}\nrenderTab('home');`, context);
  assert.equal(notice.hidden, true);
  vm.runInContext("renderTab('weekly');", context);
  assert.deepEqual(visible, [true, false]);
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /正在读取联赛数据/);
  assert.equal(countdowns, 0);
  context.snapshotError = '联赛暂时未能载入';
  vm.runInContext("renderTab('standings');", context);
  assert.equal(notice.textContent, '联赛暂时未能载入');
  const centre = read('public/match-centre.js');
  const activation = centre.slice(centre.indexOf('setActive(value)'));
  assert.match(activation, /if \(!active\) \{\s*matchUpdates\?\.close\(\); matchUpdates = null;/);
  assert.match(activation, /requestAbort\?\.abort\(\)/);
  assert.match(activation, /clearTimeout\(fallbackTimer\)/);
  assert.match(activation, /else \{ connectUpdates\(\); resume\(\); \}/);
  const resume = centre.slice(centre.indexOf('function resume()'), centre.indexOf("document.addEventListener('visibilitychange',resume)"));
  assert.match(resume, /if \(canRead\(\)\)/);
  assert.match(resume, /matchUpdates\.catchUp\(\)/);
  assert.match(resume, /else refresh\(true\)/);
});

test('home global refresh rebuilds league data and then reads the match centre', async () => {
  const app = read('public/app.js');
  const handler = app.slice(app.indexOf("$('#btnRefresh').addEventListener"), app.indexOf('/* ================= Tab 1:'));
  for (const outcome of [true, false]) {
    let click, refreshes = 0, leagueFetches = 0, errorUpdates = 0, schedules = 0, applied = 0;
    const classes = new Set(), attributes = new Map(), cleared = [];
    const button = { disabled: false, classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      setAttribute: (key, value) => attributes.set(key, value),
      addEventListener: (_, callback) => { click = callback; } };
    vm.runInNewContext(handler, { $: () => button, snapshotLoading: false, snapshotError: '', STATE: { snap: null },
      snapshotGeneration:0,snapshotRequest:null,snapshotFailures:0,AbortController,REQUESTED_LEAGUE_ID:47275,
      readSnapshot:async()=>({meta:{leagueId:47275},managers:[],players:[]}),applySnapshot:()=>applied++,leagueUpdates:null,
      window: { TQLHome: { isActive: () => true, refresh: async () => { refreshes++; return outcome; } } },
      fetch: async () => { leagueFetches++;return {ok:true,json:async()=>({ok:true})}; },
      setTimeout: () => 42,
      clearTimeout: timeout => cleared.push(timeout),
      updateRefreshStatus: () => { errorUpdates++; }, scheduleAutoRefresh: () => { schedules++; } });
    await click({ currentTarget: button });
    assert.equal(refreshes, 1);
    assert.equal(leagueFetches, 1);
    assert.equal(applied,1,'fresh league snapshot applies even if the feed read fails');
    assert.equal(errorUpdates, outcome ? 0 : 1);
    assert.deepEqual(cleared, [42]);
    assert.equal(schedules, 1);
    assert.equal(button.disabled, false);
    assert.equal(classes.has('is-refreshing'), false);
    assert.equal(attributes.get('aria-busy'), 'false');
    assert.equal(attributes.get('aria-label'), '刷新数据');
  }
});

test('embedded home isolates styling and reuses sharing without a second pageview', () => {
  const home = read('public/home-tab.js');
  assert.match(home, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(home, /document.importNode\(main, true\)/);
  assert.match(home, /template.querySelectorAll\('dialog'\)/);
  assert.doesNotMatch(home, /createElement\('iframe'\)|script\('\/analytics/);
  assert.match(read('public/match-centre.js'), /window.TQLShare.open\([^\n]+, root\)/);
  assert.match(read('public/match-centre-share.js'), /function open\(input, root = document\)/);
  assert.match(read('site-routing.js'), /redirect: main \? '\/#news' : `\/\$\{url.search\}#home`/);
  assert.match(read('analytics-report.js'), /home: '首页'/);
});

test('league ownership reaches the homepage whether the snapshot or lazy home finishes first',()=>{
  const home=read('public/home-tab.js'),app=read('public/app.js');
  assert.match(home,/let leagueSnapshot = null/);
  assert.match(home,/if \(leagueSnapshot\) controller.setLeagueSnapshot\(leagueSnapshot\)/);
  assert.match(home,/leagueSnapshot = snapshot;\s*drawCountdowns\(\);\s*controller\?\.setLeagueSnapshot\(snapshot\)/);
  assert.match(app,/STATE.snap = snapshot;\s*if[^\n]+TQLHome\?\.setLeagueSnapshot\(snapshot\)/);
});

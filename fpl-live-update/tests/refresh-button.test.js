'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const app = read('app.js');
const handlerSource = app.slice(app.indexOf("$('#btnRefresh').addEventListener"), app.indexOf('/* ================= Tab 1:'));
const readSource = app.slice(app.indexOf('async function readSnapshot('), app.indexOf('async function pollSnapshot('));

for (const fail of [false, true]) {
  test(`refresh preserves icon markup and restores its state after ${fail ? 'failure' : 'success'}`, async () => {
    let click, resolveRequest, applied = 0, scheduled = 0, statusUpdates = 0, requests = 0, previousAborts = 0;
    const attrs = {}, classes = new Set(), timers = new Map(), urls = [], acknowledgements = [];
    const oldSnapshot = {meta:{leagueId:47275,revision:'old'},players:[],managers:[]};
    const newSnapshot = {meta:{leagueId:47275,revision:'new'},players:[],managers:[]};
    const button = { disabled: false, classList: { add: v => classes.add(v), remove: v => classes.delete(v) },
      setAttribute: (key, value) => { attrs[key] = value; },
      set textContent(_) { throw new Error('Do not replace mobile icon markup'); },
      addEventListener: (_, callback) => { click = callback; } };
    const ctx = vm.createContext({ $: () => button, snapshotLoading: false, REQUESTED_LEAGUE_ID: 47275,
      snapshotGeneration: 0, snapshotRequest: {abort:()=>previousAborts++}, snapshotError: '', snapshotFailures: 0,
      STATE:{snap:oldSnapshot},AbortController,
      SNAPSHOT_ENDPOINT: '/api/league/47275',
      setTimeout(fn,ms){timers.set(1,{fn,ms});return 1;},clearTimeout:id=>timers.delete(id),
      fetch: async (url,options) => { requests++; urls.push({url,method:options.method||'GET',signal:options.signal});
        if (requests === 1) await new Promise(resolve => { resolveRequest = resolve; });
        if (fail) throw new Error('offline'); return { ok: true, json: async () => requests===1?{ok:true}:newSnapshot }; },
      applySnapshot: snapshot => { applied++;ctx.STATE.snap=snapshot; }, scheduleAutoRefresh: () => { scheduled++; },
      updateRefreshStatus:()=>statusUpdates++,leagueUpdates:{acknowledge:meta=>acknowledgements.push(meta)} });
    vm.runInContext(`${readSource}\n${handlerSource}`, ctx);
    const pending = click({ currentTarget: button });
    assert.equal(button.disabled, true);
    assert.equal(attrs['aria-busy'], 'true');
    assert.equal(attrs['aria-label'], '正在更新数据');
    assert.ok(classes.has('is-refreshing'));
    assert.equal(previousAborts,1,'manual refresh aborts its older automatic read');
    assert.equal(timers.get(1).ms,90000);
    await click({ currentTarget: button });
    assert.equal(requests, 1, 'busy clicks do not start duplicate refreshes');
    resolveRequest(); await pending;
    assert.equal(button.disabled, false);
    assert.equal(attrs['aria-busy'], 'false');
    assert.equal(attrs['aria-label'], '刷新数据');
    assert.equal(classes.has('is-refreshing'), false);
    assert.equal(ctx.snapshotLoading, false);
    assert.equal(ctx.snapshotRequest,null);
    assert.equal(timers.size,0,'request timeout is removed on both outcomes');
    assert.equal(applied, fail ? 0 : 1);
    assert.equal(statusUpdates, fail ? 1 : 0);
    assert.equal(acknowledgements.length, fail ? 0 : 1);
    assert.equal(ctx.STATE.snap,fail?oldSnapshot:newSnapshot);
    if(fail) assert.match(ctx.snapshotError,/保留上次数据/);
    assert.equal(urls[0].url,'/api/refresh?league=47275');assert.equal(urls[0].method,'POST');
    if(!fail){assert.equal(urls[1].url,'/api/league/47275');assert.equal(urls[1].method,'GET');assert.equal(urls[1].signal,urls[0].signal);}
    assert.equal(scheduled, 1);
  });
}

test('compact refresh has a bounded SVG and slow motion with reduced-motion support', () => {
  assert.match(read('index.html'), /class="compact-refresh-icon" aria-hidden="true"><svg/);
  assert.match(read('compact-header.css'), /compact-refresh-spin 1\.8s linear infinite/);
  assert.match(read('compact-header.css'), /prefers-reduced-motion: no-preference/);
  assert.match(read('compact-header.css'), /#btnRefresh \{ width: 36px; padding: 0;/);
  assert.ok(read('index.html').includes('/compact-header.css?v=75'));
});

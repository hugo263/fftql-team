'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
const start=source.indexOf('const manualRefreshes =');
const logic=source.slice(start,source.indexOf('// Public GETs may paint',start));
test('manual refresh waits for an older build and merges repeated clicks into one fresh build',async()=>{
  let finish,builds=0,feeds=0;
  const old=new Promise(r=>finish=r);
  const context=vm.createContext({config:{leagueId:47275},building:old,leagueBuilds:new Map(),
    getLeagueSnapshot:async(id,force)=>{assert.equal(id,47275);assert.equal(force,true);builds++;return{meta:{updated:'new'}};},
    matchCentreService:{get:async(gw,force)=>{assert.equal(force,true);feeds++;return{meta:{stale:false}};}},publishMatchCentre:x=>x});
  vm.runInContext(logic,context);
  const a=context.refreshWorkspaceNow(47275),b=context.refreshWorkspaceNow(47275);
  assert.equal(a,b);assert.equal(builds,0);finish();
  const result=await a;assert.equal(builds,1);assert.equal(feeds,1);assert.equal(result.snapshot.meta.updated,'new');assert.equal(result.warning,null);
});
test('a delayed match feed does not discard a successfully refreshed league',async()=>{
  const context=vm.createContext({config:{leagueId:47275},building:null,leagueBuilds:new Map(),
    getLeagueSnapshot:async()=>({meta:{updated:'new'}}),matchCentreService:{get:async()=>{throw Error('offline');}},publishMatchCentre:x=>x});
  vm.runInContext(logic,context);
  const result=await context.refreshWorkspaceNow(47275);
  assert.equal(result.snapshot.meta.updated,'new');assert.match(result.warning,/比赛动态暂时延迟/);
});

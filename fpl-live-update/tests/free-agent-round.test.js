'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const timeline=require('../public/timeline');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
const app=read('app.js');
const source=app.slice(app.indexOf('function renderFreeAgents()'),app.indexOf('function resetFreeAgentPage()'));

function render(meta,liveGwPoints) {
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:''});return nodes.get(id);};
  const context={STATE:{snap:{meta,players:[{id:1,name:'Player',team:'ARS',pos:'DEF',status:'a',lastGwPoints:7,liveGwPoints,totalPoints:20}]},freeAgentPage:1,freeAgentSearch:'',freeAgentTeam:'',freeAgentPos:'',freeAgentSort:'epNext'},
    $,$$:()=>[],TIMELINE:timeline,forecastLabel:()=>'',isUnowned:()=>true,renderFreeAgentKpis(){},matchesFreeAgentStatus:()=>true,
    normTxt:value=>String(value||''),FREE_AGENT_PAGE_SIZE:25,kitUrl:()=>'',fmtM:String,fmt1:String,esc:String,initialOf:()=>'',freeAgentStatusHtml:()=>'',bindKitFallbacks(){} };
  vm.runInNewContext(`${source}\nrenderFreeAgents();`,context);
  const cells=[...$('#freeAgentBody').innerHTML.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
  return {heading:$('#freeLastGwHead').textContent,score:cells[4][1]};
}
test('free-agent heading and score follow the same reporting GW as the weekly report',()=>{
  assert.deepEqual(render({reportGw:4,lastFinishedGw:3,currentGw:4,reportLive:true},11),{heading:'GW4',score:'11'});
  assert.deepEqual(render({reportGw:4,lastFinishedGw:4,currentGw:4,reportFinalizing:true},11),{heading:'GW4',score:'11'});
  assert.deepEqual(render({reportGw:5,lastFinishedGw:4,currentGw:5,reportLive:true},0),{heading:'GW5',score:'0'});
});
test('free-agent old snapshot never relabels last GW points as this GW points',()=>{
  assert.deepEqual(render({reportGw:4,lastFinishedGw:3,currentGw:4},undefined),{heading:'GW4',score:'—'});
  assert.deepEqual(render({reportGw:3,lastFinishedGw:3,currentGw:4},undefined),{heading:'GW3',score:'7'});
});
test('all standard table headers and numeric cells share explicit alignment and mobile insets',()=>{
  assert.match(read('style.css'),/\.table th\.ta-r, \.table td\.ta-r \{ text-align: right; \}/);
  assert.match(read('style.css'),/\.table th\.ta-c, \.table td\.ta-c \{ text-align: center; \}/);
  assert.match(read('workspace-refined.css'),/\.table th \{ padding-inline:9px; \}/);
  assert.ok(read('index.html').includes('/style.css?v=68'));
});
test('visible round selector is inside transaction gain/loss card, not the overall heading',()=>{
  const html=read('index.html');
  const card=html.match(/<section class="trade-return-card" aria-labelledby="tcCurrentTitle">([\s\S]*?)<\/section>/)[1];
  assert.match(card,/<label class="trade-round-filter" for="tcGwSel"><span>轮次<\/span>/);
  assert.match(card,/id="tcGwSel"/);
  assert.equal((html.match(/id="tcGwSel"/g)||[]).length,1);
});

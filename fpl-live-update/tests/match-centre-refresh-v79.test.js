'use strict';

// Authored for v79; intentionally not executed until the owner authorizes testing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const render = require('../public/live-render');
const source = fs.readFileSync(path.join(__dirname,'../public/match-centre.js'),'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const event = (id, extras = {}) => ({id,fixtureId:1,kind:'goal',baseline:false,points:4,value:1,delta:1,observedAt:'2026-09-14T10:00:00Z',player:{name:id,team:1},...extras});

test('new events are buffered while reading, corrections remain visible and pending counts deduplicate', () => {
  const old = event('old'), incoming = event('new'), baseline = event('baseline',{baseline:true});
  let plan = render.feedPlan([incoming,old,baseline],new Set([render.eventKey(old)]),new Set(),true);
  assert.deepEqual(plan.visible.map(e=>e.id),['old','baseline']);
  assert.deepEqual([...plan.pending],['event:new']);
  plan = render.feedPlan([incoming,{...old,points:5},baseline],new Set(['event:new','event:old','event:baseline']),plan.pending,true);
  assert.equal(plan.pending.size,1); assert.equal(plan.visible[0].points,5);
  plan = render.feedPlan([incoming,old],new Set(),plan.pending,false);
  assert.equal(plan.pending.size,0); assert.equal(plan.visible[0].id,'new');
});

test('late assist membership updates the original goal card; removed pending events disappear', () => {
  const old = event('goal'), assist = event('assist',{kind:'assist'});
  const grouped = {...old,kind:'ga',members:[old,assist]};
  assert.equal(render.eventKey(grouped),render.eventKey(old));
  const plan = render.feedPlan([grouped],new Set(['event:goal']),new Set(['event:removed']),true);
  assert.equal(plan.pending.size,0); assert.equal(plan.visible.length,1);
});

// Minimal structural DOM for the keyed renderer only: these tests check mutation,
// node identity and attributes, not CSS layout (real-browser checks remain required).
function tinyDOM() {
  class Node {
    constructor(name, value = '') { this.nodeName=name; this.nodeType=name==='#text'?3:name==='#fragment'?11:1; this.nodeValue=value;this.childNodes=[];this.attrs=new Map(); }
    get firstChild(){return this.childNodes[0] || null;}
    get nextSibling(){const siblings=this.parentNode?.childNodes || [];return siblings[siblings.indexOf(this)+1] || null;}
    get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
    get id(){return this.getAttribute('id') || '';}
    get disabled(){return this.hasAttribute('disabled');}
    get textContent(){return this.nodeType===3?this.nodeValue:this.childNodes.map(child=>child.textContent).join('');}
    set textContent(value){this.childNodes=[];if(value)this.insertBefore(new Node('#text',value),null);}
    getAttribute(name){return this.attrs.has(name)?this.attrs.get(name):null;}
    hasAttribute(name){return this.attrs.has(name);}
    setAttribute(name,value){this.attrs.set(name,String(value));}
    removeAttribute(name){this.attrs.delete(name);}
    cloneNode(){const node=new Node(this.nodeName,this.nodeValue);node.attrs=new Map(this.attrs);node.ownerDocument=doc;return node;}
    insertBefore(node,cursor){if(node.parentNode)node.parentNode.removeChild(node);const index=cursor?this.childNodes.indexOf(cursor):this.childNodes.length;this.childNodes.splice(index,0,node);node.parentNode=this;return node;}
    removeChild(node){this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;return node;}
    querySelectorAll(){const all=[];for(const child of this.childNodes){if(child.nodeType===1&&(child.hasAttribute('data-live-key')||child.id))all.push(child);all.push(...child.querySelectorAll());}return all;}
    set innerHTML(markup){
      const parent=this.content || this;parent.childNodes=[];const stack=[parent];
      for(const token of markup.match(/<[^>]+>|[^<]+/g) || []){
        if(token.startsWith('</')){stack.pop();continue;}
        let node;
        if(token.startsWith('<')){
          const name=token.match(/^<([a-z]+)/i)[1];node=new Node(name.toUpperCase());
          for(const attr of token.slice(name.length+1,-1).matchAll(/([^\s=]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2] || '');
        } else node=new Node('#text',token);
        node.ownerDocument=doc;stack.at(-1).insertBefore(node,null);if(node.nodeType===1)stack.push(node);
      }
    }
  }
  const doc={createElement(name){const node=new Node(name.toUpperCase());node.ownerDocument=doc;if(name==='template')node.content=new Node('#fragment');return node;}};
  return doc;
}

test('keyed score patches retain buttons; phase migration reuses the same match node', () => {
  const doc=tinyDOM(), target=doc.createElement('div');
  const mark=(phase,score)=>`<section data-live-key="${phase}"><div data-live-key="match:1"><button data-live-key="select:1" aria-label="${score}"><span>${score}</span></button></div></section>`;
  render.patch(target,mark('live','0–0'));
  const match=target.querySelectorAll().find(n=>n.getAttribute('data-live-key')==='match:1');
  const button=target.querySelectorAll().find(n=>n.getAttribute('data-live-key')==='select:1');
  assert.equal(render.patch(target,mark('live','0–0')),false);
  render.patch(target,mark('completed','1–0'));
  assert.equal(target.querySelectorAll().find(n=>n.getAttribute('data-live-key')==='match:1'),match);
  assert.equal(target.querySelectorAll().find(n=>n.getAttribute('data-live-key')==='select:1'),button);
  assert.equal(button.textContent,'1–0');assert.equal(button.getAttribute('aria-label'),'1–0');
});

test('keyed feed insertion retains existing card objects and clipboard success state', () => {
  const doc=tinyDOM(), target=doc.createElement('div');
  const card=id=>`<article data-live-key="event:${id}"><button data-live-key="text:${id}" data-text-share="${id}">文字分享</button></article>`;
  render.patch(target,card('old'));
  const article=target.firstChild, button=article.firstChild;button.textContent='已复制';button.setAttribute('disabled','');
  render.patch(target,card('new')+card('old'));
  assert.equal(target.childNodes[1],article);assert.equal(article.firstChild,button);
  assert.equal(button.textContent,'已复制');assert.equal(button.disabled,true);
});

function snapshot(gw=4,revision='one') { return {
  meta:{gw,revision,updated:'2026-09-14T10:00:00Z',finished:false,data_checked:false}, gameweeks:[{id:3},{id:4},{id:5}],
  fixtures:[{id:1,started:true,minutes:60,team_h_score:0,team_a_score:0,kickoff_time:'2026-09-14T09:00:00Z',home:{id:1,name:'Home',short_name:'ARS'},away:{id:2,name:'Away',short_name:'MCI'}}],events:[event('old')]
}; }
function harness({initial=snapshot(),preload=null,search='',streamHealthy=true}={}) {
  const nodes=new Map(), requests=[], connections=[], animations=[], timers=[], documentListeners=new Map(), windowListeners=new Map();let next=initial, first=true,time=Date.parse('2026-09-14T10:00:00Z');
  class ClockDate extends Date { static now(){return time;} }
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='',writes=0;const attrs=new Map(),listeners=new Map(),classes=new Set();
    const value={id,tagName:id==='gwSelect'?'SELECT':'DIV',value:'',textContent:'',disabled:false,hidden:false,dataset:{},listeners,
      get innerHTML(){return html;},set innerHTML(value){html=value;writes++;},get writes(){return writes;},
      classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),toggle:(key,on)=>on?classes.add(key):classes.delete(key)},
      addEventListener:(type,fn)=>listeners.set(type,fn),setAttribute:(key,value)=>attrs.set(key,String(value)),
      getBoundingClientRect:()=>({top:0,bottom:400}),focus(){},scrollIntoView(){},querySelectorAll:()=>[],
      animate:(frames,options)=>animations.push({id,frames,options}),
      setCustomValidity(){},reportValidity(){},showModal(){},close(){}};
    value.parentElement=value;nodes.set(id,value);return value;
  }
  const document={getElementById:id=>first&&id==='matches'?null:node(id),querySelector:node,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentListeners.set(name,fn),visibilityState:'visible'};
  const window={addEventListener:(name,fn)=>windowListeners.set(name,fn),TQLLiveRender:{...render,captureAnchor:()=>null,restoreAnchor(){}},TQLUpdates:{connect(options){connections.push(options);return {healthy:()=>streamHealthy,close(){},acknowledge(){}};}}};
  if(preload)window.__fplInitialMatchCentre=preload;
  const navigator={onLine:true};
  const context=vm.createContext({window,document,location:{search},URL,URLSearchParams,Intl,Date:ClockDate,AbortSignal,AbortController,Promise,Set,Map,
    localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false}),setTimeout:(fn,ms)=>{const id=timers.length;timers.push({fn,due:time+ms});return id;},clearTimeout:id=>{if(timers[id])timers[id].cancelled=true;},setInterval(){},navigator,
    fetch:async(url,options)=>{requests.push({url,options});const value=typeof next==='function'?await next():next;if(value instanceof Error)throw value;return{ok:true,json:async()=>JSON.parse(JSON.stringify(value))};}});
  vm.runInContext(source,context);first=false;const controller=window.TQLMatchCentre.mount(document);
  return{node,requests,connections,animations,timers,window,document,controller,navigator,setReply:value=>{next=value;},changeGw(gw){node('gwSelect').value=String(gw);node('gwSelect').listeners.get('change')();},
    async advance(ms){time+=ms;for(const timer of timers.filter(timer=>!timer.cancelled&&timer.due<=time)){timer.cancelled=true;timer.fn();}await flush();},
    async visibility(value){document.visibilityState=value;documentListeners.get('visibilitychange')();await flush();},
    async fire(name,event={}){windowListeners.get(name)?.(event);await flush();}};
}

test('unchanged push does not rewrite feed; incoming data buffers below fold and updates scores',async()=>{
  const h=harness();await flush();const before=h.node('feed').writes;
  await h.controller.refresh(true);assert.equal(h.node('feed').writes,before);
  const next=snapshot(4,'two');next.fixtures[0].team_h_score=1;next.events.unshift(event('new'));h.setReply(next);
  await h.controller.refresh(true);
  assert.match(h.node('matches').innerHTML,/1 比 0/);assert.doesNotMatch(h.node('feed').innerHTML,/data-text-share="new"/);
  assert.equal(h.animations.length,1);assert.equal(h.animations[0].options.duration,2200);
  assert.match(h.node('showNewEvents').textContent,/1 条新动态/);
  const more=h.node('loadMore').listeners.get('click');more();
  assert.doesNotMatch(h.node('feed').innerHTML,/data-text-share="new"/,'loading older cards must not reveal buffered new cards');
});

test('manual click joining a silent read shows progress without issuing a duplicate request',async()=>{
  const h=harness();await flush();let release;
  h.setReply(()=>new Promise(resolve=>{release=resolve;}));
  const silent=h.controller.refresh(true);await flush();
  const count=h.requests.length;
  const manual=h.node('refreshData').listeners.get('click')({type:'click'});
  assert.equal(manual,silent);
  assert.equal(h.requests.length,count);
  assert.equal(h.node('refreshData').disabled,true);
  assert.match(h.node('refreshStatus').textContent,/正在刷新/);
  release(snapshot());await manual;
  assert.equal(h.node('refreshData').disabled,false);
  assert.equal(h.node('refreshStatus').hidden,false);
  assert.match(h.node('refreshStatus').textContent,/已检查，暂无新动态/);
});

test('manual refresh reveals buffered events even when the newest snapshot has not changed',async()=>{
  const h=harness();await flush();const next=snapshot(4,'new-feed');next.events.unshift(event('new'));
  h.setReply(next);await h.controller.refresh(true);
  assert.doesNotMatch(h.node('feed').innerHTML,/data-text-share="new"/);
  await h.node('refreshData').listeners.get('click')({type:'click'});
  assert.match(h.node('feed').innerHTML,/data-text-share="new"/);
  assert.equal(h.node('showNewEvents').hidden,true);
  assert.match(h.node('refreshStatus').textContent,/已同步最新可用/);
});

test('failed manual refresh restores the button and displays a visible retry message',async()=>{
  const h=harness();await flush();const previous=h.node('matches').innerHTML;
  h.setReply(new Error('offline'));await h.node('refreshData').listeners.get('click')({type:'click'});
  assert.equal(h.node('refreshData').disabled,false);
  assert.equal(h.node('matches').innerHTML,previous);
  assert.equal(h.node('refreshStatus').hidden,false);
  assert.match(h.node('refreshStatus').textContent,/刷新未成功.*重试/);
});

test('background completion replaces a manual refresh waiting message',async()=>{
  const h=harness();await flush();const waiting=snapshot();waiting.meta.refreshing=true;
  h.setReply(waiting);await h.controller.refresh();
  assert.match(h.node('refreshStatus').textContent,/后台正在同步/);
  h.setReply(snapshot());await h.controller.refresh(true);
  assert.doesNotMatch(h.node('refreshStatus').textContent,/正在同步/);
  assert.equal(h.node('refreshData').disabled,false);
});

test('a minute tick keeps feed unchanged and does not flash scores',async()=>{
  const h=harness();await flush();const writes=h.node('feed').writes;
  const next=snapshot(4,'next-minute');next.fixtures[0].minutes=61;h.setReply(next);await h.controller.refresh(true);
  assert.equal(h.node('feed').writes,writes);assert.equal(h.animations.length,0);
  assert.match(h.node('matches').innerHTML,/61′/);
});

test('an unchanged SSE check can complete the visible manual refresh waiting state',async()=>{
  const h=harness();await flush();const waiting=snapshot();waiting.meta.refreshing=true;
  h.setReply(waiting);await h.controller.refresh();
  assert.match(h.node('refreshStatus').textContent,/后台正在同步/);
  h.connections.at(-1).onChecked({updated:waiting.meta.updated,refreshing:false,stale:false});
  assert.match(h.node('refreshStatus').textContent,/已检查，比赛数据已同步/);
  assert.equal(h.node('refreshData').disabled,false);
});

test('GW switch cancels an in-flight refresh; late old round cannot overwrite newer round',async()=>{
  const h=harness();await flush();let release;
  h.setReply(()=>new Promise(resolve=>{release=resolve;}));const old=h.controller.refresh(true);await flush();
  h.setReply(snapshot(5,'new-round'));h.changeGw(5);await flush();
  assert.equal(h.requests.at(-2).options.signal.aborted,true);
  assert.equal(h.node('gwSelect').value,'5');release(snapshot(4,'late-old'));await old;
  assert.equal(h.node('gwSelect').value,'5');assert.equal(h.connections.at(-1).url,'/api/updates?channel=discover&gw=5');
});

test('network failures keep scores and original source time; live connection cannot clear data delay',async()=>{
  const h=harness();await flush();const scores=h.node('matches').innerHTML;
  h.setReply(new Error('offline'));assert.equal(await h.controller.refresh(true),false);
  h.connections.at(-1).onStatus({status:'live'});
  assert.equal(h.node('matches').innerHTML,scores);assert.match(h.node('snapshotTime').textContent,/数据延迟.*18:00:00/);
  assert.match(h.node('dataNotice').textContent,/保留/);
});

test('default first mount consumes early data request once; refreshing cache does not acknowledge final delivery',async()=>{
  const initial=snapshot();initial.meta.refreshing=true;
  const h=harness({preload:Promise.resolve({data:initial})});await flush();
  assert.equal(h.requests.length,0);assert.equal(h.window.__fplInitialMatchCentre,undefined);
  h.setReply(initial);assert.equal(await h.controller.refresh(true),false);
  const explicit=harness({search:'?gw=5',initial:snapshot(5),preload:Promise.resolve({data:snapshot(4)})});await flush();
  assert.equal(explicit.requests[0].url,'/api/match-centre?gw=5');assert.equal(explicit.node('gwSelect').value,'5');
});

test('repeated setActive(true) after a prefetched mount does not issue a second cache read',async()=>{
  const h=harness({preload:Promise.resolve({data:snapshot()})});
  h.controller.setActive(true);await flush();
  assert.equal(h.requests.length,0);assert.equal(h.connections.length,1);
  h.controller.setActive(true);h.controller.setActive(true);await flush();
  assert.equal(h.requests.length,0);assert.equal(h.connections.length,1);
  h.controller.setActive(false);h.controller.setActive(true);await flush();
  assert.equal(h.requests.length,1,'a real inactive-to-active transition must still catch up');
});

test('same active state remains able to retry a failed first load',async()=>{
  const h=harness({initial:new Error('temporary network failure')});await flush();
  assert.equal(h.requests.length,1);assert.equal(h.connections.length,0);
  h.setReply(snapshot());h.controller.setActive(true);await flush();
  assert.equal(h.requests.length,2);assert.equal(h.connections.length,1);
  assert.match(h.node('matches').innerHTML,/Home|阿森纳/);
});

test('first pageshow does not repeat a completed cache read; persisted history restore catches up',async()=>{
  const h=harness();await flush();
  assert.equal(h.requests.length,1);
  await h.fire('pageshow',{persisted:false});assert.equal(h.requests.length,1);
  await h.fire('pageshow',{persisted:true});assert.equal(h.requests.length,2);
});

test('without a live stream the fallback reads at the 10-second source deadline, not on a 60-second tick',async()=>{
  const initial=snapshot();initial.meta.refreshSeconds=10;
  const h=harness({initial,streamHealthy:false});await flush();
  await h.advance(9000);assert.equal(h.requests.length,1);
  await h.advance(1000);assert.equal(h.requests.length,2);
});

test('healthy streams suppress redundant reads; refreshing and uncertain GW data get a 7.5-second catch-up',async()=>{
  const initial=snapshot();initial.meta.refreshSeconds=10;
  const h=harness({initial});await flush();await h.advance(60000);assert.equal(h.requests.length,1);
  initial.meta.refreshing=true;initial.meta.selectionPending=true;
  const pending=harness({initial});await flush();
  assert.match(pending.node('snapshotTime').textContent,/GW4 上次数据.*正在确认当前轮次/);
  assert.match(pending.node('dataNotice').textContent,/不代表该轮仍在进行/);
  await pending.advance(7500);assert.equal(pending.requests.length,2);
});

test('server retryAt takes priority over uncertain-GW 7.5-second recovery',async()=>{
  const initial=snapshot();initial.meta.refreshing=true;initial.meta.selectionPending=true;initial.meta.retryAt='2026-09-14T10:05:00Z';
  const h=harness({initial});await flush();
  for(let i=0;i<4;i++)await h.advance(60000);
  assert.equal(h.requests.length,1);
  await h.advance(60000);assert.equal(h.requests.length,2);
});

for (const [mode, seconds, expected] of [
  ['match',10,/赛中每 10 秒检查/],
  ['finalizing',60,/赛后结算每 1 分钟检查/],
  ['history',900,/历史轮次每 15 分钟核验/],
  ['idle',10800,/非比赛时每 3 小时检查/],
]) test(`refresh policy label describes ${mode} without pretending all refreshes are live`,async()=>{
  const initial=snapshot();initial.meta.refreshMode=mode;initial.meta.refreshSeconds=seconds;
  const h=harness({initial});await flush();
  assert.match(h.node('.source-label').textContent,expected);
  if(mode!=='match')assert.doesNotMatch(h.node('.source-label').textContent,/赛中|比赛时每 900 秒/);
});

test('uncertain current round labels do not claim the cached history is live',async()=>{
  const initial=snapshot();initial.meta.refreshMode='history';initial.meta.refreshSeconds=900;initial.meta.selectionPending=true;
  const h=harness({initial});await flush();
  assert.match(h.node('.source-label').textContent,/当前轮次确认中.*保留上次数据/);
  assert.doesNotMatch(h.node('.source-label').textContent,/赛中|赛后结算/);
});

test('hidden and offline fallback stops; reopening and reconnecting read the shared cache immediately',async()=>{
  const initial=snapshot();initial.meta.refreshSeconds=10;
  const h=harness({initial,streamHealthy:false});await flush();
  await h.visibility('hidden');await h.advance(60000);assert.equal(h.requests.length,1);
  await h.visibility('visible');assert.equal(h.requests.length,2);
  h.navigator.onLine=false;await h.fire('offline');await h.advance(60000);assert.equal(h.requests.length,2);
  h.navigator.onLine=true;await h.fire('online');assert.equal(h.requests.length,3);
});

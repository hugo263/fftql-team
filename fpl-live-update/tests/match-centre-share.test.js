'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/match-centre-share.js'),'utf8');
function harness(empty=false){
  const labels=[],canvases=[];
  const context=new Proxy({measureText:text=>({width:Array.from(String(text)).length*18}),fillText:(value,x,y)=>labels.push({value,x,y})},{get:(target,key)=>key in target?target[key]:()=>{}});
  const sandbox={window:{},Intl,Blob,URL,URLSearchParams,setTimeout,clearTimeout,Image:class {set src(v){queueMicrotask(()=>this.onerror?.());}},location:{search:'?league=47275'},document:{fonts:{ready:Promise.resolve()},createElement:tag=>{
    assert.equal(tag,'canvas');const canvas={getContext:()=>context,toBlob:(cb,type)=>cb(empty?null:new Blob(['png'],{type}))};canvases.push(canvas);return canvas;
  }}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/night-share.js'),'utf8'),sandbox);
  sandbox.TQLNightShare=sandbox.window.TQLNightShare;
  vm.runInNewContext(source.replace('Object.freeze({ open })','Object.freeze({ open, snapshotInput, renderCard })'),sandbox);
  return {api:sandbox.window.TQLShare,labels,canvases};
}
test('minimal image includes every grouped member and URL, without logo, title, timestamp or context',async()=>{
  const h=harness();
  const events=Array.from({length:7},(_,i)=>({title:`Player ${i} (ARS)`,points:i===6?'−2':'+5',tag:'⚽',icon:'goal'}));
  const snapshot=h.api.snapshotInput({compact:true,title:'DO NOT DRAW',subtitle:'NO CONTEXT',events,meta:{gw:4,updated:'2026-09-13T12:00:00Z'}});
  await h.api.renderCard(snapshot);
  const text=h.labels.map(l=>l.value).join('\n');
  for(const e of events)assert.ok(text.includes(e.title));
  assert.match(text,/fftql\.team/);
  assert.doesNotMatch(text,/DO NOT DRAW|NO CONTEXT|FPL 暂定|GW4|2026|源快照|TQL/);
  assert.equal(h.canvases.at(-1).width,1080);
  assert.equal(h.canvases.at(-1).height,1440);
  assert.ok(h.labels.every(l=>l.y>=0&&l.y<Math.max(...h.canvases.map(c=>c.height))));
});
test('minimal export preserves unknown points and reports encoding errors',async()=>{
  const h=harness(true);
  const snapshot=h.api.snapshotInput({compact:true,events:[{title:'Unknown (IPS)',points:'待同步'}]});
  await assert.rejects(h.api.renderCard(snapshot),/PNG 图片生成失败/);
  assert.ok(h.labels.some(l=>l.value==='待同步'));
});

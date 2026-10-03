const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'../public',f),'utf8');
function setup(){
 const ids=['headerLeagueGuideOpen','headerLeagueGuide','headerLeagueGuideClose','headerLeagueGuideDone','headerLeagueGuideTitle','headerLeagueId'];
 let focused=null; const locks=new Set();
 const elements=Object.fromEntries(ids.map(id=>[id,{open:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},focus(){focused=id;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},getBoundingClientRect(){return {left:20,right:400,top:20,bottom:500};}}]));
 vm.runInNewContext(read('league-id-guide.js'),{document:{getElementById:id=>elements[id],documentElement:{classList:{add:c=>locks.add(c),remove:c=>locks.delete(c)}}}});
 return {elements,locks,focused:()=>focused,click:id=>elements[id].listeners.click({target:elements[id]})};
}
test('ID guide is a non-submit button before the ID input and is independent of data loading',()=>{
 const html=read('index.html');
 assert.match(html, /id="headerLeagueGuideOpen" type="button"[^>]+aria-haspopup="dialog"/);
 assert.ok(html.includes('id="headerLeagueGuideOpen"') && html.includes('id="headerLeagueId"'));
 assert.match(html, /<details id="draftLeagueSwitch"/);
 assert.match(html, /<dialog id="headerLeagueGuide"[^>]+aria-labelledby="headerLeagueGuideTitle"/);
 assert.match(html, /不是球队 ID，也不是加入联赛的邀请码/);
 assert.match(html, /同一联赛的所有成员使用同一个 ID/);
 assert.doesNotMatch(read('league-id-guide.js'), /fetch\(|STATE|TQLHome/);
});
test('guide opens, locks background, focuses title and returns focus when closed',()=>{
 const h=setup();h.click('headerLeagueGuideOpen');
 assert.equal(h.elements.headerLeagueGuide.open,true);assert(h.locks.has('league-id-guide-open'));assert.equal(h.focused(),'headerLeagueGuideTitle');
 h.click('headerLeagueGuideClose');assert.equal(h.elements.headerLeagueGuide.open,false);assert.equal(h.locks.size,0);assert.equal(h.focused(),'headerLeagueGuideOpen');
 h.click('headerLeagueGuideOpen');h.click('headerLeagueGuideDone');assert.equal(h.focused(),'headerLeagueId');assert.equal(h.locks.size,0);
});
test('only backdrop clicks close the guide; native close restores the trigger',()=>{
 const h=setup(),dialog=h.elements.headerLeagueGuide;h.click('headerLeagueGuideOpen');
 dialog.listeners.click({target:dialog,clientX:30,clientY:50});assert(dialog.open);
 dialog.listeners.click({target:dialog,clientX:10,clientY:50});assert.equal(dialog.open,false);assert.equal(h.focused(),'headerLeagueGuideOpen');
 h.click('headerLeagueGuideOpen');dialog.close();assert.equal(h.locks.size,0);assert.equal(h.focused(),'headerLeagueGuideOpen');
});

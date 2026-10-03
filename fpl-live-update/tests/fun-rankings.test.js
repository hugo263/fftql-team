'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {benchRow,collectFunRankings}=require('../fun-rankings');
const {rank}=require('../public/fun-model');
test('fun rankings default to all rounds and selecting a GW switches to that round',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../public/fun-rankings.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.match(js,/mode='season'/);
 assert.match(html,/<option value="all" selected>所有轮次<\/option>/);
 assert.ok(!html.includes('data-fun-mode='));
 assert.match(js,/mode=all\?'season':'round'/);
 assert.match(js,/gwPinned=!all/);
 assert.match(js,/mode==='season'\|\|!gwPinned/);
});
function setup(){
 const types=['GKP','DEF','DEF','DEF','DEF','MID','MID','MID','MID','FWD','FWD','GKP','MID','DEF','FWD'];
 const players=new Map(types.map((pos,i)=>[i+1,{id:i+1,name:`P${i+1}`,pos,team:'AAA',teamCode:1}]));
 const payload={picks:types.map((_,i)=>({element:i+1,position:i+1})),subs:[]};
 const live={elements:Object.fromEntries(types.map((_,i)=>[i+1,{stats:{minutes:90,total_points:i+1,yellow_cards:0,red_cards:0}}]))};
 const fixtures=[{id:1,event:1,team_h:1,team_a:2,started:true,finished:true}],teams=[{id:1,code:1},{id:2,code:2}];
 return {players,payload,live,fixtures,teams,manager:{entryId:11,entryName:'甲'}};
}
function bench(s){return benchRow(s.manager,s.payload,s.players,s.live,s.fixtures,s.teams,1,true);}
test('bench excludes officially substituted-in players and does not double-apply swapped positions',()=>{
 const s=setup();s.payload.subs=[{element_out:11,element_in:13}];
 s.live.elements[11].stats={minutes:0,total_points:0,yellow_cards:0,red_cards:0};
 let row=bench(s);assert.equal(row.benchPoints,12+0+14+15);assert.equal(row.provisional,false);
 assert.deepEqual(row.bench.map(p=>p.id),[12,11,14,15]);
 s.payload.picks[10].position=13;s.payload.picks[12].position=11;
 assert.deepEqual(bench(s),row);
});
test('projected substitutes use priority, not highest points, and remain provisional',()=>{
 const s=setup();s.live.elements[11].stats.minutes=0;s.live.elements[11].stats.total_points=0;
 const row=bench(s);assert.equal(row.provisional,true);assert.equal(row.benchPoints,41);assert.ok(!row.bench.some(p=>p.id===13));
});
test('missing scores or incomplete locked picks never turn into zero bench points',()=>{
 const s=setup();delete s.live.elements[13].stats.total_points;assert.throws(()=>bench(s));
 s.payload.picks.pop();assert.throws(()=>bench(s));
});
test('bench counts actual negative and zero points',()=>{
 const s=setup();s.live.elements[12].stats.total_points=-2;s.live.elements[13].stats.total_points=0;
 assert.equal(bench(s).benchPoints,27);
});
const match=(a,b,x,y)=>({entry1Id:a,entry1:`M${a}`,entry1Points:x,entry2Id:b,entry2:`M${b}`,entry2Points:y});
const round=(gw,matches=[],managers=[])=>({gw,started:true,settled:true,complete:true,matches,managers});
test('high-score loss excludes draws and wins; duplicate fixtures do not double count',()=>{
 const m=match(1,2,50,51),data={rounds:[round(1,[m,m,match(3,4,50,50),match(5,6,60,65)])]};
 assert.deepEqual(rank(data,'unlucky','round',1).rows.map(r=>[r.entryId,r.value]),[[5,60],[1,50]]);
});
test('narrow single round sorts winning margins ascending with competition ties',()=>{
 const data={rounds:[round(1,[match(1,2,51,50),match(3,4,22,20),match(5,6,11,10)])]};
 assert.deepEqual(rank(data,'narrow','round',1).rows.map(r=>[r.entryId,r.value,r.rank]),[[1,1,1],[5,1,1],[3,2,3]]);
});
test('season narrow wins use inclusive three-point threshold, then mean margin',()=>{
 const data={rounds:[round(1,[match(1,2,53,50),match(3,4,21,20),match(5,6,55,50)]),round(2,[match(1,4,21,20),match(3,2,21,20)])]};
 assert.deepEqual(rank(data,'narrow','season',2).rows.map(r=>[r.entryId,r.value,r.average]),[[3,2,1],[1,2,2]]);
});
test('season totals stop at selected GW and keep each source detail',()=>{
 const manager=(value)=>({entryId:1,entryName:'M1',benchPoints:value,bench:[]});
 const data={rounds:[round(1,[],[manager(10)]),round(2,[],[manager(-2)]),round(3,[],[manager(999)])]};
 const result=rank(data,'bench','season',2);assert.equal(result.rows[0].value,8);assert.equal(result.rows[0].details.length,2);
 assert.equal(rank(data,'bench','round',2).rows[0].value,-2);
});
test('future placeholders cannot become ranking entries; absent data remains incomplete',()=>{
 const data={rounds:[{...round(1,[match(1,2,999,0)]),started:false}]};
 assert.equal(rank(data,'unlucky','round',1).rows.length,0);assert.equal(rank(data,'bench','round',2).incomplete,true);
});
test('unsettled rounds and missing managers are explicitly marked',()=>{
 const data={rounds:[{...round(1,[match(1,2,10,9)]),settled:false,complete:false}]};
 const view=rank(data,'narrow','round',1);assert.equal(view.rows[0].provisional,true);assert.equal(view.incomplete,true);
});
test('average-opponent fixture ranks a real manager but not a fictitious manager',()=>{
 const data={rounds:[round(1,[match(1,undefined,10,20)])]};
 assert.equal(rank(data,'unlucky','round',1).rows.length,1);assert.equal(rank(data,'narrow','round',1).rows.length,0);
});
function collectOptions(s,cacheDir){return {snapshot:{meta:{leagueId:55,season:'2026/27',reportGw:1},managers:[s.manager],players:[...s.players.values()],h2hByGw:{1:[]}},events:[{id:1,finished:true,data_checked:true}],teams:s.teams,draftApi:'draft',classicApi:'classic',cacheDir,squads:new Map([[11,s.payload]]),squadGwByEntry:new Map([[11,1]]),ownershipPicksByGw:new Map(),reportLive:s.live,reportFixtures:s.fixtures,reportLineups:new Map(),fetchJson:async()=>{throw Error('unexpected fetch');}};}
test('complete final history freezes independently of later ownership and avoids upstream calls',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fun-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=setup(),options=collectOptions(s,dir);const first=await collectFunRankings(options);assert.equal(first.rounds[0].settled,true);
 s.payload.picks.reverse();s.live.elements[12].stats.total_points=900;s.manager.entryName='new';
 const second=await collectFunRankings(options);assert.deepEqual(second,first);
 const other=await collectFunRankings({...options,snapshot:{...options.snapshot,meta:{...options.snapshot.meta,leagueId:66}}});
 assert.notEqual(other.rounds[0].managers[0].benchPoints,first.rounds[0].managers[0].benchPoints);
});
test('provisional results never freeze and missing source can recover',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fun-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=setup(),options=collectOptions(s,dir);s.live.elements[11].stats.minutes=0;s.live.elements[11].stats.total_points=0;
 assert.equal((await collectFunRankings(options)).rounds[0].settled,false);
 assert.equal(fs.readdirSync(dir).filter(n=>n.startsWith('fun-round')).length,0);
 s.payload.subs=[{element_out:11,element_in:13}];delete s.live.elements[15].stats.total_points;
 const missing=await collectFunRankings(options);assert.equal(missing.rounds[0].complete,false);assert.equal(missing.rounds[0].managers.length,0);
 s.live.elements[15].stats.total_points=15;assert.equal((await collectFunRankings(options)).rounds[0].settled,true);
});
test('six primary destinations retain all old routes under related subnavigation',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const primary=html.match(/class="nav-primary"[\s\S]*?<\/div>/)[0];assert.equal((primary.match(/<button/g)||[]).length,6);
 for(const leaf of ['home','weekly','standings','fixtures','trades','freeagents','trade','compare','share','predict','fun'])assert.ok(html.includes(`id="tab-${leaf}"`));
 assert.match(html,/data-nav-group="rankings"[\s\S]*?data-tab="fun"/);
 assert.match(html,/data-nav-group="trading"[\s\S]*?data-tab="freeagents"/);
});

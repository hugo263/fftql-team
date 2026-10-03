'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createNewsProxy}=require('../news-proxy');
const model=require('../public/portal-news-model');
const fs=require('node:fs'),path=require('node:path');
const {pageRoute}=require('../site-routing');
const {adminNewsResponse}=require('../admin-news-sso');
function response() { return {headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}}; }
test('all category badges use distinct accessible colors and share one palette with the news site',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../public/news-categories.css'),'utf8');
  const inks=[],backgrounds=[];
  function luminance(hex){const rgb=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
  for(const key of Object.keys(model.categories)){
    const rule=css.match(new RegExp('data-category="'+key+'"\\]\\{--category-ink:#([A-F0-9]+);--category-bg:#([A-F0-9]+)'));
    assert.ok(rule,key);inks.push(rule[1]);backgrounds.push(rule[2]);assert.ok((luminance(rule[2])+.05)/(luminance(rule[1])+.05)>=4.5,key+' contrast');
  }
  assert.equal(new Set(inks).size,10);assert.equal(new Set(backgrounds).size,10);
});
test('homepage and Draft split preserve league queries and the local preview',()=>{
  assert.deepEqual(pageRoute(new URL('https://fftql.team/')),{file:'/portal.html'});
  assert.deepEqual(pageRoute(new URL('https://fftql.team/?league=47275')),{file:'/index.html'});
  assert.deepEqual(pageRoute(new URL('https://fftql.team/draft?league=47275')),{file:'/index.html'});
  assert.deepEqual(pageRoute(new URL('https://draft.fftql.team/?league=47275')),{});
  assert.deepEqual(pageRoute(new URL('http://127.0.0.1:4323/?league=47275')),{});
  assert.deepEqual(pageRoute(new URL('http://127.0.0.1:4323/portal')),{file:'/portal.html'});
});
test('published adapter keeps official price observations without fabricated published dates',()=>{
  const item={id:'price_1',title:'<script>not markup</script>',summary:'真实摘要',timelineAt:'2026-10-01T00:00:00Z',publishedAt:null,source:{name:'FPL 官方数据'},category:'prices',tags:['Classic','官方确认']};
  const result=model.fromPayload({cards:[{item},{item}]});
  assert.equal(result.length,1);assert.equal(result[0].publishedAt,null);assert.equal(result[0].timelineAt,item.timelineAt.replace('Z','.000Z'));
  assert.equal(result[0].title,item.title);assert.deepEqual(result[0].tags,item.tags);
  assert.equal(model.fromPayload({items:[{...item,id:'../admin'},{...item,timelineAt:'bad'}]}).length,0);
  assert.equal(model.safeOriginal('javascript:alert(1)'),null);assert.equal(model.safeOriginal('https://user:pass@example.com'),null);
});
test('all ten live categories and grouped public stories are retained',()=>{
  assert.equal(Object.keys(model.categories).length,10);
  assert.equal(model.categories.teams,'球队复盘');assert.equal(model.categories.news,'英超快讯');
  const result=model.fromPayload({cards:[{item:{id:'valid',title:'资讯',timelineAt:'2026-10-01',category:'injuries'},group:{story:{publicId:'story_1'},reportCount:3}}]});
  assert.equal(result[0].category,'injuries');assert.equal(result[0].storyId,'story_1');assert.equal(result[0].reportCount,3);
});
test('price bulletins retain all members and reject incomplete or mixed-observation data',()=>{
  const at='2026-10-03T01:00:00.000Z',before='2026-10-03T00:50:00.000Z';
  const batch={observationId:8,observedAt:at,previousCheckedAt:before,changes:[
    {id:1,name:'Player A',team:'ARS',position:'中场',oldCost:7.5,newCost:7.6,observedAt:at},
    {id:2,name:'Player B',team:'LIV',position:'后卫',oldCost:5,newCost:4.9,observedAt:at}
  ]};
  assert.equal(model.normalizePriceBatch(batch).changes.length,2);
  assert.equal(model.normalizePriceBatch({...batch,changes:[...batch.changes,{...batch.changes[0],id:3,observedAt:before}]}),null);
  assert.equal(model.normalizePriceBatch({...batch,changes:[...batch.changes,batch.changes[0]]}),null);
  const items=model.fromPayload({items:[{id:'bulletin',title:'价格变动',category:'prices',timelineAt:at,priceBatch:batch}]});
  assert.deepEqual(items[0].priceBatch,model.normalizePriceBatch(batch));
  assert.equal(items[0].publishedAt,null);
});
test('homepage has one news list without a duplicated featured first article',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/portal.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/portal.js'),'utf8');
  assert.doesNotMatch(html,/id="featuredNews"/);assert.doesNotMatch(js,/featuredNews/);
  assert.match(html,/id="newsList"/);assert.match(js,/priceBulletin\(item.priceBatch\)/);
});
test('news proxy only reaches the fixed public read layer and does not forward auth',async()=>{
  const calls=[], proxy=createNewsProxy({fetcher:async(url,options)=>{calls.push({url:String(url),options});return new Response('{"cards":[]}',{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=60',ETag:'"test"','Set-Cookie':'private=secret'}});}});
  const res=response();await proxy({method:'GET',headers:{cookie:'admin=private',authorization:'secret','if-none-match':'"old"'}},res,new URL('https://fftql.team/api/news/timeline?category=injuries'));
  assert.equal(calls[0].url,'http://127.0.0.1:9011/api/site/timeline?category=injuries');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(calls[0].options.headers,{Accept:'application/json','If-None-Match':'"old"'});
  assert.equal(res.status,200);assert.equal(res.headers.etag,'"test"');assert.equal(res.headers['set-cookie'],undefined);
});
test('admin endpoints, mutations and path tricks cannot be proxied',async()=>{
  const proxy=createNewsProxy({fetcher:()=>{throw Error('Must not request');}});
  for(const path of ['/api/news/admin','/api/news/items/a/original','/api/news/https://evil.example','/api/news/%2e%2e/admin']){
    const res=response();await proxy({method:'GET',headers:{}},res,new URL('https://fftql.team'+path));assert.equal(res.status,404);
  }
  const res=response();await proxy({method:'POST',headers:{}},res,new URL('https://fftql.team/api/news/pool'));assert.equal(res.status,405);
});
test('news failures and oversized responses are explicit; no fake content is substituted',async()=>{
  for(const fetcher of [async()=>{throw Error('Offline');},async()=>new Response('<html>bad</html>'),async()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'3000000'}})]){
    const res=response();await createNewsProxy({fetcher})({method:'GET',headers:{}},res,new URL('https://fftql.team/api/news/pool'));
    assert.ok([502,503].includes(res.status));assert.equal(res.headers['Cache-Control'],'no-store');assert.ok(JSON.parse(res.body).error);
  }
});
test('new admin SSO keeps authenticated one-use POST tickets and anonymous gate',()=>{
  const anon=adminNewsResponse(false,0,'');assert.equal(anon.status,302);assert.equal(anon.headers.Location,'/admin?section=news');
  const now=Date.now(), response=adminNewsResponse(true,now+60000,'a'.repeat(64),now);
  assert.equal(response.status,200);assert.match(response.body,/method="post" action="https:\/\/news.fftql.team\/api\/auth\/draft-sso"/);
  assert.equal(response.headers['Cache-Control'],'no-store');assert.match(response.headers['Content-Security-Policy'],/frame-ancestors 'none'/);
});

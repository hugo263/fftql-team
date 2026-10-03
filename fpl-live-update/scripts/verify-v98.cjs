'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const origin='https://fftql.team',checks=[];
async function get(url,status=200){const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});assert.equal(response.status,status,url);checks.push({url,status:response.status});return response;}
async function main(){
  const portal=await(await get(origin+'/')).text();assert.ok(portal.includes('portal.js?v=98'));assert.ok(portal.includes('aria-label="进入网站管理后台"'));assert.ok(portal.includes('粤ICP备2026075584号-3'));
  const docs=[portal];for(const path of ['/draft','/draft/?league=47275','/?league=47275','/discover.html?v=97','/share-styles.html','/admin'])docs.push(await(await get(origin+path)).text());
  assert.ok(docs[1].includes('night-site-head'));assert.ok(docs[1].includes('workspace-ui.js'));assert.ok(docs.at(-1).includes('admin.css?v=20261002a'));
  const assets=new Set();for(const html of docs)for(const m of html.matchAll(/(?:src|href)="(\/(?:[^"?#]+\.(?:css|js|png|jpg|svg|ico)|site\.webmanifest)(?:\?[^"#]*)?)"/g))assets.add(m[1]);
  const pending=[...assets];let i=0;await Promise.all(Array.from({length:4},async()=>{while(i<pending.length){const path=pending[i++],response=await get(origin+path);assert.ok(!response.headers.get('content-type')?.includes('text/html'),path+' SPA fallback');}}));
  const timeline=await(await get(origin+'/api/news/timeline?limit=20')).json();assert.ok(Array.isArray(timeline.cards)&&timeline.cards.length);assert.ok(timeline.cards.every(c=>c.item.id&&c.item.title));
  const id=timeline.cards[0].item.id;const detail=await(await get(origin+'/api/news/items/'+encodeURIComponent(id))).json();assert.ok(detail.item||detail.id);
  const pool=await(await get(origin+'/api/news/pool?q=Saka')).json();assert.ok(Array.isArray(pool.items));
  const prices=await(await get(origin+'/api/news/fpl/prices')).json();assert.ok(prices);
  await get(origin+'/api/admin/analytics',401);await get(origin+'/api/news/admin',404);await get(origin+'/api/news/items/../admin',404);
  const sso=await get(origin+'/admin/news',302);assert.equal(sso.headers.get('location'),'/admin?section=news');
  const legacy=await get('https://fpl.xiaokailabs.com/?league=47275',308);assert.equal(legacy.headers.get('location'),origin+'/?league=47275');
  const illegal=await fetch(origin+'/api/news/timeline',{method:'POST',signal:AbortSignal.timeout(10000)});assert.equal(illegal.status,405);checks.push({url:'POST /api/news/timeline',status:405});
  const out={version:98,at:new Date().toISOString(),checks:checks.length,publishedItems:timeline.cards.length,assets:assets.size,passed:true,results:checks};
  fs.writeFileSync('/Users/ken/Documents/个人网站计划/output/fpl-v98/http-verification.json',JSON.stringify(out,null,2));console.log(JSON.stringify({...out,results:undefined},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

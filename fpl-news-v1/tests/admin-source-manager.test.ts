import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { createSource, sourceDetail, previewSource, testSource, configHash, fetchNow } from "@aihot/backend/admin/sources";
import { collectSource } from "@aihot/backend/sources/collect";
import { assertSourceConfig } from "@aihot/backend/sources/config-keys";
import { passwordLogin, SESSION_COOKIE } from "@aihot/backend/admin/auth";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";
import { registerAdmin } from "../apps/api/src/routes/admin.ts";
const id = `source-manager-${Date.now()}`;
const feed=http.createServer((req,res)=>{
  if(req.url==='/failed'){res.writeHead(503);res.end('down');return;}
  res.setHeader('Content-Type','application/rss+xml');
  const entries=Array.from({length:8},(_,i)=>`<item><title>${i===0?'Sponsor offer':'FPL injury update '+i}</title><link>https://example.com/news/${id}/${i}</link><pubDate>${new Date(Date.now()-i*60000).toUTCString()}</pubDate><author>FPL editor</author><description>Player availability and expected line-up ${i}</description></item>`).join('');
  res.end(`<rss version="2.0"><channel><title>FPL test</title>${entries}</channel></rss>`);
});
await new Promise<void>(resolve=>feed.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${(feed.address() as {port:number}).port}`;
config.allowPrivateNetworkFetch=true;
await getBoss();
const settings={feedUrl:url+'/feed',_aihot:{initialBackfillLimit:3},ingestNoiseFilter:{dropMarkersTitleOnly:['sponsor']}};
after(async()=>{
  await sql`DELETE FROM pgboss.job WHERE data->>'sourceId'=${id} OR data->>'articleId' IN(SELECT id FROM articles WHERE source_id=${id})`;
  await sql`DELETE FROM articles WHERE source_id=${id}`;
  await sql`DELETE FROM audit_log WHERE subject=${'source:'+id}`;
  await sql`DELETE FROM sources WHERE id=${id}`;
  await new Promise<void>(resolve=>feed.close(()=>resolve()));
  await stopBoss();await closeDb();
});

test('configuration validates adapter requirements and first-import limits',()=>{
  for(const [kind,settings] of [['rss',{}],['web_list',{url:'file:///etc/passwd'}],['rss',{feedUrl:url,_aihot:{initialBackfillLimit:1000}}],['mp_account',{nickname:'name'}],['rss',{feedUrl:url,wrongKey:true}]] as const) assert.throws(()=>assertSourceConfig(kind as never,settings as never));
  assert.equal(configHash({b:1,a:{z:2,y:3}}),configHash({a:{y:3,z:2},b:1}));
});
test('new sources default paused and summary-only; duplicate feed is not recreated',async()=>{
  const r=await createSource({id,name:'FPL fixture test',kind:'rss',config:settings},'test-admin');
  assert.ok(r.created);assert.equal(r.source!.enabled,false);assert.equal(r.source!.site_fulltext,false);
  const duplicate=await createSource({id:id+'-dup',name:'Same feed',kind:'rss',config:settings},'test-admin');
  assert.equal(duplicate.created,false);
});
test('testing uses collector filters and retains data without articles or processing jobs',async()=>{
  const result=await testSource(id,{},'test-admin');
  assert.equal(result?.status,'ok');assert.equal(result?.count,8);assert.equal(result?.acceptedCount,3);assert.equal(result?.matchesSavedConfig,true);
  assert.equal(result!.items[0]!.title,'FPL injury update 1');assert.ok(result!.items[0]!.excerpt.includes('Player availability'));
  assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${id}`)[0]!.n,0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'sourceId'=${id}`)[0]!.n,0);
  const detail=await sourceDetail(id);assert.equal(detail!.tests.length,1);assert.equal(detail!.tests[0]!.matchesSavedConfig,true);
});
test('unsaved config is tested, persisted and marked distinct from collection config',async()=>{
  const detail=await sourceDetail(id);
  const result=await testSource(id,{config:{...settings,_aihot:{initialBackfillLimit:1}},version:new Date(detail!.source.updated_at).toISOString()},'test-admin');
  assert.equal(result?.acceptedCount,1);assert.equal(result?.matchesSavedConfig,false);
  assert.equal((await sourceDetail(id))!.tests[0]!.matchesSavedConfig,false);
  await assert.rejects(()=>testSource(id,{config:settings,version:'2000-01-01'},'test-admin'),/刷新/);
});
test('failures and empty results are visible and retained, not masquerading as success',async()=>{
  const detail=await sourceDetail(id);const version=new Date(detail!.source.updated_at).toISOString();
  const failure=await testSource(id,{config:{feedUrl:url+'/failed'},version},'test-admin');
  assert.equal(failure?.status,'failed');assert.match(failure!.error!,/503/);
  const empty=await previewSource({id,kind:'rss',config:{...settings,allowUrlPrefixes:['https://nowhere.example/']}});
  assert.equal(empty.status,'empty');assert.equal(empty.acceptedCount,0);
  assert.equal((await sourceDetail(id))!.tests[0]!.result.status,'failed');
});
test('manual collection refuses a disabled collector or missing worker',async()=>{
  assert.equal(process.env.COLLECT_ENABLED,'false');
  await assert.rejects(()=>fetchNow(id,'test-admin'),/COLLECT_ENABLED/);
  process.env.COLLECT_ENABLED='true';
  await sql`DELETE FROM settings WHERE key='heartbeat.worker'`;
  await assert.rejects(()=>fetchNow(id,'test-admin'),/未在线/);
  process.env.COLLECT_ENABLED='false';
});
test('formal collection matches test window, stores extraction and deduplicates subsequent runs',async()=>{
  config.modelCallsEnabled=false;
  const collected=await collectSource(id,{force:true});assert.equal(collected.status,'ok');assert.equal(collected.created,3);
  const detail=await sourceDetail(id);assert.equal(detail!.items.length,3);assert.ok(detail!.items.every(i=>i.excerpt && i.published_at));
  assert.equal((await collectSource(id,{force:true})).created,4);
  assert.equal((await collectSource(id,{force:true})).created,0);
});
test('test endpoints enforce admin session, CSRF and malformed config returns 400',async()=>{
  config.adminPassword='local-source-manager-password';
  const login=await passwordLogin(config.adminPassword,'/admin','source-manager-test');const cookie=`${SESSION_COOKIE}=${login.token}`;
  const app=Fastify({logger:false});registerAdminAuth(app);registerAdmin(app);
  try {
    assert.equal((await app.inject({method:'POST',url:`/api/admin/sources/${id}/preview`,payload:{}})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:`/api/admin/sources/${id}/preview`,headers:{cookie},payload:{}})).statusCode,403);
    const me=(await app.inject({method:'GET',url:'/api/admin/me',headers:{cookie}})).json();
    const headers={cookie,'x-csrf-token':me.csrf};
    assert.equal((await app.inject({method:'POST',url:'/api/admin/sources/preview',headers,payload:{id,kind:'garbage',config:{}}})).statusCode,400);
    const tested=await app.inject({method:'POST',url:`/api/admin/sources/${id}/preview`,headers,payload:{}});
    assert.equal(tested.statusCode,200);assert.equal(tested.json().status,'ok');
    await app.inject({method:'POST',url:'/api/auth/logout',headers:{cookie}});
  } finally {await app.close();}
});

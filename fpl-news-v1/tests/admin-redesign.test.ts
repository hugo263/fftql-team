import "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { adminOverview } from "@aihot/backend/admin/overview";
import { searchContent } from "@aihot/backend/admin/content";
import { buildApp } from "../apps/api/src/app.ts";
const id = `redesign-${randomUUID().slice(0,8)}`;
const at = new Date();
const day = new Date(at.getTime()+8*3600_000).toISOString().slice(0,10);
const midnight = new Date(day+"T00:00:00+08:00");
let receipt: number;
let baseline: Awaited<ReturnType<typeof adminOverview>>;
before(async()=>{
  baseline=await adminOverview(at);
  await sql`INSERT INTO sources(id,name,kind,config,enabled,health,fail_count) VALUES(${id},'Redesign test','rss','{}',true,'degraded',2)`;
  for (const [suffix,state,time] of [["old","new",new Date(midnight.getTime()-1)], ["today","failed",midnight]] as const) {
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,processing_state) VALUES(${id+'-'+suffix},${id},${id+'-'+suffix},${'https://example.test/'+id+'/'+suffix},${'FPL '+suffix},${time},${time},${state})`;
  }
  const [r]=await sql`INSERT INTO receipts(logical_key,service,purpose,status,origin) VALUES(${id},${id},'test','unknown','live') RETURNING id`;
  receipt=Number(r!.id);
  for (const [attempt,currency,cost,origin] of [[1,"USD",0.25,"live"],[2,"CNY",1.75,"live"],[3,"USD",100,"replay"]] as const) {
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,origin,status,cost,currency,cost_basis,started_at) VALUES(${receipt},${attempt},${id},${origin},'received',${cost},${currency},'estimated',${midnight})`;
  }
});
after(async()=>{
  await sql`DELETE FROM receipt_attempts WHERE receipt_id=${receipt}`;
  await sql`DELETE FROM receipts WHERE id=${receipt}`;
  await sql`DELETE FROM articles WHERE source_id=${id}`;
  await sql`DELETE FROM sources WHERE id=${id}`;
  await closeDb();
});
test('overview separates Beijing today, current backlog, unknown receipts and each currency',async()=>{
  const r=await adminOverview(at);
  assert.equal(r.day,day);
  assert.equal(r.attention!.sources,baseline.attention!.sources+1);
  assert.equal(r.attention!.receipts,baseline.attention!.receipts+1);
  assert.equal(r.operations!.discovered,baseline.operations!.discovered+1);
  assert.equal(r.operations!.waiting,baseline.operations!.waiting+1);
  const costs=r.costs.filter(c=>c.service===id);
  assert.deepEqual(costs.map(c=>[c.currency,Number(c.amount)]),[["CNY",1.75],["USD",0.25]]);
  assert.ok(costs.every(c=>c.day===day));
});
test('content can list without a search; source and state filters are combined and parameterized',async()=>{
  const all=await searchContent('',{source:id});
  assert.equal(all.length,2);
  assert.equal((await searchContent('',{source:id,processing:'failed'}))[0]!.id,id+'-today');
  assert.equal((await searchContent('old',{source:id}))[0]!.id,id+'-old');
  assert.equal((await searchContent('',{source:id,page:2})).length,0);
  assert.equal((await searchContent('',{source:"' OR true --"})).length,0);
  await assert.rejects(()=>searchContent('',{processing:'anything'}));
});
test('new overview and expanded list require an admin session',async()=>{
  const saved=config.devAdmin;config.devAdmin=null;
  const app=await buildApp();
  try {
    assert.equal((await app.inject({url:'/api/admin/overview'})).statusCode,401);
    assert.equal((await app.inject({url:'/api/admin/content?processing=failed'})).statusCode,401);
  } finally { await app.close();config.devAdmin=saved; }
});

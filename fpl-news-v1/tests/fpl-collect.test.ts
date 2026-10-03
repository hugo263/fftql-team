import "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectFpl } from "../packages/backend/src/fpl/collect.ts";
import { loadFplPrices } from "../packages/backend/src/publication/fpl.ts";
import { loadPool } from "../packages/backend/src/publication/pool.ts";
import { loadItemDetail } from "../packages/backend/src/publication/detail.ts";
import { priceBulletin, publishFplChanges } from "../packages/backend/src/fpl/price-bulletins.ts";
import { upsertMaterial } from "../packages/backend/src/content/materials.ts";
import { publishArticle } from "../packages/backend/src/publication/publish.ts";
import { FPL_SOURCE_URL } from "../packages/backend/src/fpl/data.ts";

const fixture = {
  elements: Array.from({length:100},(_,i)=>({code:900000+i,id:i+1,web_name:`Test${i}`,first_name:"Test",second_name:`Player${i}`,team:i%20+1,element_type:2,now_cost:i===0?100:i===1?80:60,cost_change_start:0,status:"a",chance_of_playing_next_round:100,news:"",news_added:null})),
  teams:Array.from({length:20},(_,i)=>({id:i+1,name:`Club ${i}`,short_name:i===0?"ARS":`T${i}`})),
  events:[{id:1,deadline_time:"2026-08-14T17:30:00Z",is_next:true,is_current:false}],
};
const fetchReal=globalThis.fetch;
globalThis.fetch=async()=>Response.json(fixture);
const read=()=>loadFplPrices({q:"",team:"",direction:"all"});
const nextRun=async()=>{await new Promise(r=>setTimeout(r,5));return collectFpl();};

before(async()=>{
  await sql`DELETE FROM articles WHERE source_id='fpl-official-prices'`;
  await sql`TRUNCATE fpl_price_changes,fpl_players,fpl_observations RESTART IDENTITY`;
});
after(async()=>{
  globalThis.fetch=fetchReal;
  await sql`DELETE FROM articles WHERE source_id='fpl-official-prices'`;
  await sql`TRUNCATE fpl_price_changes,fpl_players,fpl_observations RESTART IDENTITY`;
  await stopBoss();
  await closeDb();
});

test("official snapshots establish a baseline, publish changes once, and reset at season boundaries",async()=>{
  assert.deepEqual(await nextRun(),{players:100,changes:0});
  let page=await read();
  assert.equal(page.playersTotal,100);
  assert.equal(page.changesTotal,0);
  assert.ok(page.baselineAt);
  fixture.elements[0]!.now_cost=101;
  fixture.elements[1]!.now_cost=79;
  assert.deepEqual(await nextRun(),{players:100,changes:2});
  page=await read();
  assert.equal(page.changesTotal,2);
  assert.deepEqual(page.changes.map(c=>[c.code,c.oldCost,c.newCost]).sort(),[[900000,10,10.1],[900001,8,7.9]]);
  assert.equal((await loadFplPrices({q:"",team:"阿森纳",direction:"up"})).changesTotal,1);
  assert.equal((await loadFplPrices({q:"_",team:"",direction:"all"})).playersTotal,0,"search wildcards are literal");
  let published=await sql`SELECT p.tags,a.published_at FROM publications p JOIN articles a ON a.id=p.article_id WHERE a.source_id='fpl-official-prices' AND p.eligible`;
  assert.equal(published.length,1,"one observation creates one bulletin, not one article per player");
  assert.ok(published.every(p=>p.tags.includes("Classic")&&p.tags.includes("官方确认")&&p.published_at===null));
  const pool=await loadPool({channel:"all",category:"prices",tag:null,q:"Test1"});
  assert.equal(pool.items.length,1,"search can find any member of a bulletin");
  assert.equal(pool.items[0]!.priceBatch!.changes.length,2);
  assert.match(pool.items[0]!.summary!,/上涨：Test0/);
  assert.match(pool.items[0]!.summary!,/下跌：Test1/);
  const detail=await loadItemDetail(pool.items[0]!.id);
  assert.equal(detail.kind,"found");
  if(detail.kind==='found')assert.deepEqual(detail.detail.priceBatch!.changes.map(c=>[c.oldCost,c.newCost]),[[10,10.1],[8,7.9]]);
  assert.deepEqual(await nextRun(),{players:100,changes:0});
  assert.equal((await read()).changesTotal,2,"unchanged data does not duplicate a change");
  fixture.elements[99]!.code=900200;
  fixture.elements[99]!.now_cost=45;
  assert.deepEqual(await nextRun(),{players:100,changes:0});
  assert.equal((await read()).playersTotal,100,"players removed from the latest official response leave the current market");
  // A stored change whose publication was lost is repaired on the next successful run.
  await sql`DELETE FROM publications WHERE article_id IN(SELECT id FROM articles WHERE source_id='fpl-official-prices')`;
  await nextRun();
  published=await sql`SELECT p.article_id FROM publications p JOIN articles a ON a.id=p.article_id WHERE a.source_id='fpl-official-prices' AND p.eligible`;
  assert.equal(published.length,1);
  const [analyses]=await sql`SELECT count(*) n FROM analyses WHERE article_id IN(SELECT id FROM articles WHERE source_id='fpl-official-prices')`;
  assert.equal(Number(analyses!.n),1,"repair reuses the deterministic analysis");
  const [beforeFailure]=await sql`SELECT count(*) n FROM fpl_observations`;
  globalThis.fetch=async()=>new Response("failed",{status:503});
  await assert.rejects(nextRun(),/FPL upstream 503/);
  globalThis.fetch=async()=>Response.json({...fixture,elements:fixture.elements.slice(0,99)});
  await assert.rejects(nextRun());
  const [afterFailure]=await sql`SELECT count(*) n FROM fpl_observations`;
  assert.equal(Number(afterFailure!.n),Number(beforeFailure!.n),"failed or incomplete fetches leave the last good snapshot intact");
  globalThis.fetch=async()=>Response.json(fixture);
  fixture.events[0]!.deadline_time="2027-08-13T17:30:00Z";
  fixture.elements[0]!.now_cost=110;
  assert.deepEqual(await nextRun(),{players:100,changes:0});
  page=await read();
  assert.equal(page.season,"2027/28");
  assert.equal(page.changesTotal,0,"new season prices do not become daily changes");
  assert.equal(page.players.find(p=>p.code===900000)!.cost,11);
});

test("historical single-player items consolidate without deleting price history or old links",async()=>{
  const at=new Date('2026-09-15T01:00:00Z'),previous=new Date('2026-09-15T00:50:00Z');
  const [observation]=await sql`INSERT INTO fpl_observations(season,checked_at,prices,gameweek) VALUES('2026/27',${at},'{}',5) RETURNING id`;
  const legacy:string[]=[];
  for(const [code,name,oldCost,newCost] of [[910001,'LegacyRise',60,61],[910002,'LegacyFall',70,69]] as const){
    const [change]=await sql`INSERT INTO fpl_price_changes(observation_id,season,player_code,name,team,position,old_cost,new_cost,previous_checked_at,observed_at,gameweek)
      VALUES(${observation!.id},'2026/27',${code},${name},'阿森纳','中场',${oldCost},${newCost},${previous},${at},5) RETURNING id`;
    const m=await upsertMaterial({sourceId:'fpl-official-prices',identityKey:`fpl-price:${change!.id}`,url:FPL_SOURCE_URL,title:name,bodyText:'价格记录',language:'zh',bodyStatus:'ok',via:'fetch',discoveredAt:at});
    legacy.push(m.articleId);
    await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected)
      VALUES(${m.articleId},1,'rule','pass','prices',ARRAY['Classic'],${name},'价格记录',true)`;
    await publishArticle(m.articleId,{releasedAt:at});
  }
  const outcome=await publishFplChanges();
  assert.equal(outcome.legacyUnlisted,2);
  const pool=await loadPool({channel:'all',category:'prices',tag:null,q:'Legacy'});
  assert.equal(pool.items.length,1);
  assert.equal(pool.items[0]!.priceBatch!.changes.length,2);
  for(const id of legacy)assert.equal((await loadItemDetail(id)).kind,'found');
  assert.equal((await sql`SELECT 1 FROM fpl_price_changes WHERE observation_id=${observation!.id}`).length,2);
  assert.deepEqual(await publishFplChanges(),{published:0,legacyUnlisted:0,skippedEditorial:0});
});

async function legacyObservation(at:string,name:string) {
  const time=new Date(at),previous=new Date(time.getTime()-600000);
  const [o]=await sql`INSERT INTO fpl_observations(season,checked_at,prices,gameweek) VALUES('2026/27',${time},'{}',6) RETURNING id`;
  const [c]=await sql`INSERT INTO fpl_price_changes(observation_id,season,player_code,name,team,position,old_cost,new_cost,previous_checked_at,observed_at,gameweek)
    VALUES(${o!.id},'2026/27',920001,${name},'阿森纳','中场',60,61,${previous},${time},6) RETURNING id`;
  const m=await upsertMaterial({sourceId:'fpl-official-prices',identityKey:`fpl-price:${c!.id}`,url:FPL_SOURCE_URL,title:name,bodyText:'价格记录',language:'zh',bodyStatus:'ok',via:'fetch',discoveredAt:time});
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected)
    VALUES(${m.articleId},1,'rule','pass','prices',ARRAY['Classic'],${name},'价格记录',true)`;
  await publishArticle(m.articleId,{releasedAt:time});
  return {id:m.articleId,observationId:Number(o!.id)};
}

test("manual withdrawals and field edits cannot be resurrected by price consolidation",async()=>{
  const a=await legacyObservation('2026-09-16T01:00:00Z','ProtectedWithdrawal');
  const b=await legacyObservation('2026-09-16T02:00:00Z','ProtectedEdit');
  await sql`INSERT INTO editorial_overrides(article_id,visibility,reason,updated_by) VALUES(${a.id},'withdrawn','editor review','test-editor')`;
  await sql`INSERT INTO editorial_overrides(article_id,fields,reason,updated_by) VALUES(${b.id},'{"title":"人工标题"}','editor review','test-editor')`;
  await publishArticle(a.id);await publishArticle(b.id);
  assert.equal((await publishFplChanges()).skippedEditorial,2);
  assert.equal((await sql`SELECT 1 FROM articles WHERE identity_key IN ${sql([`fpl-price-batch:${a.observationId}`,`fpl-price-batch:${b.observationId}`])}`).length,0);
  const [edited]=await sql`SELECT title FROM publications WHERE article_id=${b.id}`;
  assert.equal(edited!.title,'人工标题');
});

test("failed legacy consolidation is atomic and separate same-day observations stay separate",async()=>{
  const a=await legacyObservation('2026-09-17T01:00:00Z','AtomicPriceOne');
  const b=await legacyObservation('2026-09-17T02:00:00Z','AtomicPriceTwo');
  // Test-only DB fault: the new bulletin must roll back if the legacy override fails.
  await sql`CREATE FUNCTION price_batch_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.updated_by='rule:price-batch-v2' THEN RAISE EXCEPTION 'price batch test fault'; END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER price_batch_test_fail BEFORE INSERT OR UPDATE ON editorial_overrides FOR EACH ROW EXECUTE FUNCTION price_batch_test_fail()`;
  try {
    await assert.rejects(publishFplChanges(),/price batch test fault/);
    assert.equal((await sql`SELECT 1 FROM articles WHERE identity_key IN ${sql([`fpl-price-batch:${a.observationId}`,`fpl-price-batch:${b.observationId}`])}`).length,0);
    const old=await sql`SELECT visibility FROM publications WHERE article_id IN ${sql([a.id,b.id])}`;
    assert.ok(old.every(p=>p.visibility==='public'));
  } finally {
    await sql`DROP TRIGGER price_batch_test_fail ON editorial_overrides`;
    await sql`DROP FUNCTION price_batch_test_fail()`;
  }
  assert.equal((await publishFplChanges()).published,2);
  const result=await loadPool({channel:'all',category:'prices',tag:null,q:'AtomicPrice'});
  assert.equal(result.items.length,2);
  assert.ok(result.items.every(i=>i.priceBatch?.changes.length===1));
  assert.equal((await publishFplChanges()).published,0);
});

test("bulletins reject mixed batches and retain single-direction empty groups",()=>{
  const first={id:1,observation_id:1,season:'2026/27',player_code:1,name:'OnlyRise',team:'ARS',position:'中场',old_cost:60,new_cost:61,observed_at:new Date('2026-10-01T01:00:00Z'),previous_checked_at:new Date('2026-10-01T00:50:00Z'),gameweek:6};
  assert.match(priceBulletin([first]).summary,/下跌：无/);
  assert.throws(()=>priceBulletin([first,{...first,observation_id:2}]),/one observation/);
  assert.throws(()=>priceBulletin([]),/one observation/);
});

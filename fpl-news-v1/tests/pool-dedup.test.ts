import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {publishArticle} from '@aihot/backend/publication/publish';
import {loadPool} from '@aihot/backend/publication/pool';
import {v1Items} from '@aihot/backend/publication/v1';
import {itemFeed} from '@aihot/backend/publication/feeds';
import {stopBoss} from '@aihot/backend/jobs/queue';

const T=tag(),source='test-dedup-'+T,filterTag='dedup-'+T,now=new Date();
let n=0,story:number,fact:number,development:number,first:string,repeated:string,next:string;
before(async()=>{
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at)
    VALUES(${source},'Repeat author','x_search','T2','editorial','2100-01-01')`;
  const [s]=await sql`INSERT INTO stories(public_id,title,first_report_at,latest_at)
    VALUES(${randomUUID()},${T},${now},${now}) RETURNING id`;
  story=Number(s!.id);
  const [f]=await sql`INSERT INTO facts(public_id,story_id,title) VALUES(${T+'-agreement'},${story},'Verbal agreement') RETURNING id`;
  const [d]=await sql`INSERT INTO facts(public_id,story_id,title) VALUES(${T+'-signed'},${story},'Official signing') RETURNING id`;
  fact=Number(f!.id);development=Number(d!.id);
});
after(async()=>{await stopBoss();await closeDb();});
async function article(factId:number|null,summary:string,score=22,category='transfers'){
  n++;
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/${T}/${n}`,title:`Arsenal ${T} ${n}`,bodyText:summary,bodyStatus:'ok',via:'fetch',publishedAt:new Date(now.getTime()-n*1000)});
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected)
    VALUES(${articleId},1,'rule','pass',${category},${[filterTag]},${'阿森纳 '+T+' '+n},${summary},${score},false)`;
  if(factId!==null)await sql`INSERT INTO fact_articles(fact_id,article_id,role) VALUES(${factId},${articleId},'report')`;
  await publishArticle(articleId);
  return articleId;
}
const query={channel:'all' as const,category:null,tag:filterTag,now:new Date(now.getTime()+3600000)};

test('same author and occurrence occupy one row, but a new stage remains separate',async()=>{
  first=await article(fact,`Verbal agreement ${T}. UniqueFirst`,30);
  repeated=await article(fact,`Player said yes ${T}. UniqueRepeat`,22);
  next=await article(development,`Signed officially ${T}`,50);
  const pool=await loadPool(query);
  assert.equal(pool.total,2);assert.equal(pool.todayCount,2);
  assert.deepEqual(new Set(pool.items.map(i=>i.id)),new Set([first,next]));
});

test('search and category filters choose a matching representative, without losing the occurrence',async()=>{
  for(const tab of ['time','relevance'] as const){
    const pool=await loadPool({...query,q:'UniqueRepeat',tab});
    assert.equal(pool.total,1);assert.equal(pool.items[0]!.id,repeated);
  }
  const alternate=await article(fact,`Other category ${T}`,80,'news');
  assert.equal((await loadPool({...query,category:'transfers'})).items.find(i=>i.id===first)?.id,first);
  assert.deepEqual((await loadPool({...query,category:'news'})).items.map(i=>i.id),[alternate]);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${alternate}`;
  assert.equal((await loadPool(query)).total,2,'a withdrawn high-score report cannot hide the remaining public one');
});

test('deduplication happens before pagination and both counts use the same grouped scope',async()=>{
  for(let i=0;i<41;i++)await article(null,`Standalone ${T} ${i}`);
  const one=await loadPool(query),two=await loadPool({...query,page:2});
  assert.equal(one.total,43);assert.equal(two.total,43);assert.equal(one.pageCount,2);
  assert.equal(one.items.length,40);assert.equal(two.items.length,3);
  const ids=[...one.items,...two.items].map(i=>i.id);
  assert.equal(new Set(ids).size,43);assert.ok(ids.includes(first));assert.ok(!ids.includes(repeated));
});

test('all-mode API and RSS collapse the same occurrence while original links remain stored',async()=>{
  const api=await v1Items({mode:'all',window:'7d',by:'published',category:null,q:T,limit:100,cursor:null},query.now);
  assert.ok(api.items.some(i=>i.id===first));assert.ok(!api.items.some(i=>i.id===repeated));assert.ok(api.items.some(i=>i.id===next));
  const rss=await itemFeed('all',null,query.now);
  assert.ok(rss.includes(first));assert.ok(!rss.includes(repeated));
  assert.equal((await sql`SELECT count(*) AS n FROM articles WHERE id=ANY(${[first,repeated]})`)[0]!.n,2);
});

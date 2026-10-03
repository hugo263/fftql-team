import type { FplPriceBatch } from "@aihot/contracts/fpl";
import { sql } from "../db.ts";
import { upsertMaterial } from "../content/materials.ts";
import { publishArticleTx } from "../publication/publish.ts";
import { FPL_SOURCE_URL } from "./data.ts";

interface ChangeRow {
  id: number; observation_id: number; season: string; player_code: number;
  name: string; team: string; position: string; old_cost: number; new_cost: number;
  observed_at: Date; previous_checked_at: Date; gameweek: number | null;
}

export function priceBulletin(rows: ChangeRow[]) {
  const first = rows[0];
  if (!first || rows.some(c => c.observation_id !== first.observation_id || c.season !== first.season || c.observed_at.getTime()!==first.observed_at.getTime())) throw Error("Price bulletin must contain one observation");
  const batch: FplPriceBatch = {
    observationId: Number(first.observation_id), season: first.season,
    observedAt: first.observed_at.toISOString(), previousCheckedAt: first.previous_checked_at.toISOString(), gameweek: first.gameweek,
    changes: rows.map(c => ({id:Number(c.id),code:Number(c.player_code),name:c.name,team:c.team,position:c.position,
      oldCost:c.old_cost/10,newCost:c.new_cost/10,previousCheckedAt:c.previous_checked_at.toISOString(),observedAt:c.observed_at.toISOString(),gameweek:c.gameweek})),
  };
  const up=batch.changes.filter(c=>c.newCost>c.oldCost), down=batch.changes.filter(c=>c.newCost<c.oldCost);
  const date=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(first.observed_at);
  const names=(changes:typeof up)=>changes.map(c=>`${c.name}（${c.team}）`).join("、")||"无";
  const title=`FPL 价格变动 · ${date} · ${up.length} 人上涨 / ${down.length} 人下跌`;
  const summary=`上涨：${names(up)}。\n下跌：${names(down)}。`;
  const note="FPL 官方前后两次成功采集的价格差异，所示时间是本站发现时间，并非官方调价时刻。仅适用于 Classic，不是涨跌预测。";
  const body=summary+"\n\n"+batch.changes.map(c=>`${c.name}（${c.team} · ${c.position}）：£${c.oldCost.toFixed(1)}m → £${c.newCost.toFixed(1)}m`).join("\n")+"\n\n"+note;
  const tags=["价格变动","Classic","官方确认",...(up.length?["涨价"]:[]),...(down.length?["跌价"]:[]),
    ...new Set(rows.flatMap(c=>[`球员:${c.name}`,c.team])),...(first.gameweek?[`GW${first.gameweek}`]:[])];
  return {batch,title,summary,body,tags};
}

/** Immutable per-observation bulletins. No model calls; existing price records stay intact.
 * Existing per-player links become unlisted summary pages, atomically with the new bulletin.
 * Explicit editorial overrides are left alone for human review, never resurrected in a batch.
 */
export async function publishFplChanges() {
  await sql`INSERT INTO sources(id,name,kind,tier,first_party,participation_mode,site_fulltext,syndicate_fulltext,enabled)
    VALUES('fpl-official-prices','FPL 官方数据','external','T1',true,'editorial',false,false,false) ON CONFLICT(id) DO NOTHING`;
  const observations=await sql<{observation_id:number}[]>`
    SELECT DISTINCT c.observation_id FROM fpl_price_changes c
    WHERE NOT EXISTS(SELECT 1 FROM articles a JOIN publications p ON p.article_id=a.id WHERE a.identity_key='fpl-price-batch:'||c.observation_id::text)
    ORDER BY c.observation_id DESC LIMIT 200`;
  const result={published:0,legacyUnlisted:0,skippedEditorial:0};
  for(const observation of observations){
    const outcome=await sql.begin(async tx=>{
      const key=`fpl-price-batch:${observation.observation_id}`;
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const [done]=await tx`SELECT 1 FROM articles a JOIN publications p ON p.article_id=a.id WHERE a.identity_key=${key}`;
      if(done)return {published:0,legacyUnlisted:0,skippedEditorial:0};
      const rows=await tx<ChangeRow[]>`SELECT * FROM fpl_price_changes WHERE observation_id=${observation.observation_id} ORDER BY id`;
      if(!rows.length)return {published:0,legacyUnlisted:0,skippedEditorial:0};
      const identities=rows.map(c=>`fpl-price:${c.id}`);
      const legacy=await tx<{id:string}[]>`SELECT id FROM articles WHERE source_id='fpl-official-prices' AND identity_key IN ${tx(identities)} ORDER BY id FOR UPDATE`;
      const alreadyUnlisted=new Set<string>();
      if(legacy.length){
        const overrides=await tx`SELECT article_id,fields,visibility,updated_by FROM editorial_overrides WHERE article_id IN ${tx(legacy.map(a=>a.id))} FOR UPDATE`;
        for(const o of overrides){
          if(Object.keys(o.fields??{}).length>0)return {published:0,legacyUnlisted:0,skippedEditorial:1};
          if(o.visibility==='summary-only' && o.updated_by==='rule:price-batch-v2')alreadyUnlisted.add(o.article_id);
          else if(o.visibility!==null)return {published:0,legacyUnlisted:0,skippedEditorial:1};
        }
      }
      const {batch,title,summary,body,tags}=priceBulletin(rows);
      const material=await upsertMaterial({sourceId:"fpl-official-prices",identityKey:key,url:FPL_SOURCE_URL,title,
        bodyText:body,language:"zh",bodyStatus:"ok",via:"fetch",discoveredAt:rows[0]!.observed_at,
        ...(legacy.length?{backfill:"price-batch-consolidation"}:{}),raw:{priceBatch:batch}},tx);
      await tx`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected,output)
        SELECT id,revision,'rule','pass','prices',${tags},${title},${summary},true,${tx.json({rule:"official-price-batch-v2"})}
        FROM articles WHERE id=${material.articleId} AND NOT EXISTS(SELECT 1 FROM analyses WHERE article_id=${material.articleId} AND origin='rule')`;
      await tx`UPDATE articles SET processing_state='analyzed' WHERE id=${material.articleId}`;
      // Stored official observations need no editorial delay; historic consolidation sends no alerts.
      await publishArticleTx(tx,material.articleId,{releasedAt:rows[0]!.observed_at});
      for(const old of legacy){
        if(alreadyUnlisted.has(old.id)){await publishArticleTx(tx,old.id);continue;}
        const reason=`价格消息合并为同次观测简报 ${material.articleId}；保留原价记录及旧链接。`;
        const written=await tx`INSERT INTO editorial_overrides(article_id,visibility,reason,version,updated_by)
          VALUES(${old.id},'summary-only',${reason},1,'rule:price-batch-v2')
          ON CONFLICT(article_id) DO UPDATE SET visibility='summary-only',reason=excluded.reason,version=editorial_overrides.version+1,updated_by=excluded.updated_by,updated_at=now()
          WHERE editorial_overrides.visibility IS NULL AND editorial_overrides.fields='{}'::jsonb RETURNING article_id`;
        if(!written.length)throw Error('Concurrent editorial change; price batch rolled back');
        await publishArticleTx(tx,old.id);
        await tx`INSERT INTO audit_log(actor,action,subject,reason,before,after)
          VALUES('rule:price-batch-v2','content.price-consolidate',${'content:'+old.id},${reason},${tx.json({visibility:null})},${tx.json({visibility:'summary-only',batchArticleId:material.articleId})})`;
      }
      return {published:1,legacyUnlisted:legacy.length-alreadyUnlisted.size,skippedEditorial:0};
    });
    result.published+=outcome.published;result.legacyUnlisted+=outcome.legacyUnlisted;result.skippedEditorial+=outcome.skippedEditorial;
  }
  return result;
}

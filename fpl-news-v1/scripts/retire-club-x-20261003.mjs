// Explicit, recoverable production source retirement; no article deletion or paid calls.
// Run from the active news release with its existing env, after gracefully stopping worker.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const actor='retire-club-x-20261003';
const ids=['arsenal','aston-villa','bournemouth','brentford','brighton','chelsea','coventry','crystal-palace','everton','fulham','hull','ipswich','leeds','liverpool','man-city','man-utd','newcastle','nottm-forest','spurs','sunderland'].map(s=>'x-club-'+s);
const dir='/opt/tql-news/backups/retire-club-x-20261003',manifest=dir+'/before.json';
const root=process.cwd();
const mod=p=>import(pathToFileURL(path.join(root,'packages/backend/src',p)).href);
const {sql,closeDb}=await mod('db.ts');
const {updateSource}=await mod('admin/sources.ts');
const {collectSource,collectXShard}=await mod('sources/collect.ts');
const {stopBoss}=await mod('jobs/queue.ts');
const {xCollectionState}=await mod('sources/x-control.ts');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protectedPaths=['/etc/tql-news/app.env','/etc/tql-news/web.env'];
const protectedHashes=()=>Object.fromEntries(protectedPaths.map(p=>[p,hash(p)]));
const counts=()=>sql`SELECT source_id,count(*)::int AS count FROM articles GROUP BY source_id ORDER BY source_id`;
const sources=()=>sql`SELECT id,name,kind,enabled,health,first_party,owner_entity_id,config,tier,participation_mode,interval_minutes,updated_at FROM sources ORDER BY id`;
try{
  if(process.argv.includes('--apply')){
    const current=await sources();
    const clubs=current.filter(s=>ids.includes(s.id));
    assert.equal(clubs.length,20);
    assert.ok(clubs.every(s=>s.kind==='x_search'&&s.first_party&&s.owner_entity_id));
    assert.equal(current.filter(s=>s.id.startsWith('x-club-')).length,20,'New club source needs explicit review');
    const jobs=await sql`SELECT id,name FROM pgboss.job WHERE name IN ('sources.fetch','sources.fetch-x') AND state IN ('created','retry','active')`;
    assert.equal(jobs.length,0,'Drain queued collection before applying');
    const [pending]=await sql`SELECT count(*)::int AS count FROM sources WHERE kind='x_search' AND jsonb_array_length(coalesce(cursor->'xBacklog','[]'))>0`;
    assert.equal(pending.count,0,'Review old batched pagination before applying');
    if(!fs.existsSync(manifest)){
      fs.mkdirSync(dir,{recursive:true,mode:0o700});
      fs.writeFileSync(manifest,JSON.stringify({at:new Date().toISOString(),sources:current,articleCounts:await counts(),xState:await xCollectionState(),protectedHashes:protectedHashes()},null,2),{flag:'wx',mode:0o600});
    }
    for(const s of clubs){
      if(!s.enabled)continue;
      await updateSource(s.id,{patch:{enabled:false},version:s.updated_at.toISOString(),reason:'用户要求：俱乐部官方 X 内容价值不足，移出自动采集；保留历史原文及审核记录。'},actor);
    }
  }else if(!process.argv.includes('--check'))throw Error('Use --apply or --check');
  const before=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const after=await sources();
  assert.ok(after.filter(s=>ids.includes(s.id)).every(s=>!s.enabled&&s.health==='paused'));
  const stable=s=>JSON.stringify({...s,updated_at:undefined});
  assert.deepEqual(after.filter(s=>!ids.includes(s.id)).map(stable),before.sources.filter(s=>!ids.includes(s.id)).map(stable),'Other source settings changed');
  assert.deepEqual(await xCollectionState(),before.xState);
  assert.deepEqual(protectedHashes(),before.protectedHashes);
  // Both checks short-circuit on paused sources, with no provider request or receipt.
  assert.equal((await collectSource(ids[0])).error,'paused');
  assert.equal((await collectXShard('retired-club-verification',ids)).status,'skipped');
  const audits=await sql`SELECT count(*)::int AS count FROM audit_log WHERE actor=${actor} AND action='source.update'`;
  assert.equal(audits[0].count,20);
  const latestCounts=await counts();
  for(const b of before.articleCounts)assert.ok((latestCounts.find(a=>a.source_id===b.source_id)?.count??0)>=b.count,'Historical articles missing');
  const result={retired:20,enabledClubX:after.filter(s=>ids.includes(s.id)&&s.enabled).length,retainedX:after.filter(s=>s.kind==='x_search'&&s.enabled).map(s=>({id:s.id,name:s.name})),auditCount:audits[0].count,historicalArticlesPreserved:true,otherSourceSettingsPreserved:true,globalXSwitchPreserved:true,environmentPreserved:true,queuedCollectionSkipsDisabled:true,backup:manifest};
  fs.writeFileSync(dir+'/result.json',JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify(result));
}finally{await stopBoss();await closeDb();}

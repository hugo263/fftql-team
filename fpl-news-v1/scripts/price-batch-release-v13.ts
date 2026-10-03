// Bounded, audited consolidation of existing official price observations; no upstream/model calls.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sql,closeDb} from '../packages/backend/src/db.ts';
import {publishFplChanges} from '../packages/backend/src/fpl/price-bulletins.ts';
import {stopBoss} from '../packages/backend/src/jobs/queue.ts';
const dir='/opt/tql-news/backups/v13-price-batches-20261003',file=dir+'/before.json';
async function status(){return {
  changes:(await sql`SELECT count(*)::int n FROM fpl_price_changes`)[0]!.n,
  observations:(await sql`SELECT count(DISTINCT observation_id)::int n FROM fpl_price_changes`)[0]!.n,
  publications:await sql`SELECT CASE WHEN a.identity_key LIKE 'fpl-price-batch:%' THEN 'batch' ELSE 'legacy' END kind,p.visibility,count(*)::int n
    FROM articles a JOIN publications p ON p.article_id=a.id WHERE a.source_id='fpl-official-prices' GROUP BY 1,2 ORDER BY 1,2`,
  sources:await sql`SELECT id,enabled FROM sources WHERE kind='x_search' ORDER BY id`
};}
try {
  if(process.argv.includes('--snapshot')) {
    if(fs.existsSync(file))throw Error('Backup already exists');
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const db=new URL(process.env.DATABASE_URL!);
    execFileSync('pg_dump',['-Fc','-f',dir+'/news-before.dump'],{env:{...process.env,PGHOST:db.hostname,PGPORT:db.port||'5432',PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1)},timeout:180000,stdio:['ignore','pipe','pipe']});
    fs.chmodSync(dir+'/news-before.dump',0o600);
    const snapshot=await sql.begin('isolation level repeatable read',async tx=>({at:new Date(),
      articles:await tx`SELECT * FROM articles WHERE source_id='fpl-official-prices'`,
      publications:await tx`SELECT * FROM publications WHERE source_id='fpl-official-prices'`,
      analyses:await tx`SELECT * FROM analyses WHERE article_id IN(SELECT id FROM articles WHERE source_id='fpl-official-prices')`,
      overrides:await tx`SELECT * FROM editorial_overrides WHERE article_id IN(SELECT id FROM articles WHERE source_id='fpl-official-prices')`,
      ledger:await tx`SELECT * FROM selected_ledger WHERE article_id IN(SELECT id FROM articles WHERE source_id='fpl-official-prices')`,
      state:await tx`SELECT * FROM selected_state WHERE article_id IN(SELECT id FROM articles WHERE source_id='fpl-official-prices')`,
      changes:await tx`SELECT * FROM fpl_price_changes`,observations:await tx`SELECT * FROM fpl_observations`
    }));
    fs.writeFileSync(file,JSON.stringify(snapshot),{mode:0o600});console.log(JSON.stringify({backup:dir,status:await status()}));
  }else if(process.argv.includes('--apply')) {
    if(!fs.existsSync(file)||!fs.statSync(dir+'/news-before.dump').size)throw Error('Backups required');
    const result=await publishFplChanges();console.log(JSON.stringify({result,status:await status()}));
  }else if(process.argv.includes('--status'))console.log(JSON.stringify(await status()));
  else throw Error('Explicit mode required');
}finally{await stopBoss();await closeDb();}

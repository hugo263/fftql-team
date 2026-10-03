// Deploy an allowlisted overlay on v11; do not touch credentials, X proxy, budgets or socket units.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),base='/opt/tql-news';
const old=base+'/releases/20261003-v11-x-socks',next=base+'/releases/20261003-v12-editorial-gate';
const files=['industry/taxonomy.ts','industry/topics.json','industry/brand/news-categories.css','industry/prompts/prefilter.md','industry/prompts/structure.md','industry/prompts/selection-score.md','industry/prompts/content-understanding.md','packages/backend/src/editorial/writing.ts','packages/backend/src/editorial/analyze.ts','apps/web/app/root.tsx','apps/web/app/features/feed/FeedItem.tsx','apps/web/app/features/feed/Filters.tsx','apps/web/app/routes/item.tsx','apps/web/app/routes/admin/content-item.tsx','scripts/review-editorial-v12.ts'];
const configs=['/etc/tql-news/app.env','/etc/tql-news/web.env','/etc/systemd/system/tql-news-web.service','/etc/systemd/system/tql-news-web.socket','/www/server/panel/vhost/nginx/tql_news.conf'];
const protectedFiles=['industry/selection.ts','packages/backend/src/providers/x-official.ts','packages/backend/src/providers/x-proxy.ts'];
const hash=p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
const manifest=base+'/v12-before.json';
const system=(...args)=>execFileSync('systemctl',args,{encoding:'utf8',timeout:240000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(fs.realpathSync(base+'/current')!==old)throw Error('Concurrent release');
if(process.argv.includes('--prepare')){
  if(fs.existsSync(next)||fs.existsSync(manifest))throw Error('Already prepared');
  fs.writeFileSync(manifest,JSON.stringify({files:Object.fromEntries(files.map(f=>[f,hash(old+'/'+f)])),configs:Object.fromEntries(configs.map(p=>[p,hash(p)])),protected:Object.fromEntries(protectedFiles.map(f=>[f,hash(old+'/'+f)]))},null,2),{mode:0o600});
  fs.cpSync(old,next,{recursive:true,dereference:false,verbatimSymlinks:true});
  console.log(JSON.stringify({prepared:next}));process.exit(0);
}
if(!process.argv.includes('--publish'))throw Error('Explicit mode required');
const before=JSON.parse(fs.readFileSync(manifest));
for(const [p,h]of Object.entries(before.configs))if(hash(p)!==h)throw Error('Concurrent config: '+p);
for(const f of files){if(hash(old+'/'+f)!==before.files[f])throw Error('Concurrent source: '+f);if(!fs.statSync(next+'/'+f).isFile())throw Error('Missing file: '+f);}
for(const [f,h]of Object.entries(before.protected))if(hash(next+'/'+f)!==h)throw Error('Protected source changed: '+f);
const backup=base+'/backups/v12-'+Date.now();fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(manifest,backup+'/before.json');
const point=target=>{const tmp=base+'/current.v12-pending';fs.symlinkSync(target,tmp);fs.renameSync(tmp,base+'/current');};
const waitApi=async()=>{for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:9011/api/site/pool?category=teams',{signal:AbortSignal.timeout(3000)});if(r.ok)return;}catch{}await sleep(500);}throw Error('API health failed');};
await exec('systemctl',['stop','tql-news-worker'],{timeout:240000});
try{
  point(next);system('restart','tql-news-api');await waitApi();
  const restart=exec('systemctl',['restart','tql-news-web'],{timeout:240000}),statuses=[];
  for(let i=0;i<12;i++){const r=await fetch('http://127.0.0.1:9012/all',{signal:AbortSignal.timeout(20000)});await r.arrayBuffer();statuses.push(r.status);await sleep(100);}
  await restart;if(statuses.some(s=>s!==200))throw Error('Web check: '+statuses);
  system('start','tql-news-worker');system('is-active','tql-news-api','tql-news-worker','tql-news-web','tql-news-web.socket');
  for(const [p,h]of Object.entries(before.configs))if(hash(p)!==h)throw Error('Config changed: '+p);
  console.log(JSON.stringify({published:next,backup,webStatuses:statuses,configPreserved:true,rollback:old}));
}catch(e){point(old);system('restart','tql-news-api','tql-news-web');system('start','tql-news-worker');throw e;}

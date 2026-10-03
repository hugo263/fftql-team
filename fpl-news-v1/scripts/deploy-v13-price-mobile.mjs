// Allowlisted overlay, backed up before price consolidation; preserve all live configuration.
import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync,execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),base='/opt/tql-news',old=base+'/releases/20261003-v12-editorial-gate',next=base+'/releases/20261003-v13-price-mobile';
const files=['packages/contracts/src/fpl.ts','packages/contracts/src/site.ts','packages/backend/src/fpl/collect.ts','packages/backend/src/fpl/price-bulletins.ts','packages/backend/src/publication/items.ts','apps/web/app/root.tsx','apps/web/app/public-site.css','apps/web/app/features/feed/FeedItem.tsx','apps/web/app/routes/item.tsx','apps/web/app/routes/topics.tsx','apps/web/app/components/TopicArtwork.tsx','apps/web/app/features/topics.css','apps/web/app/features/fpl/PriceBulletin.tsx','apps/web/app/features/fpl/price-bulletin.css','industry/brand/news-categories.css','scripts/price-batch-release-v13.ts'];
const configs=['/etc/tql-news/app.env','/etc/tql-news/web.env','/etc/systemd/system/tql-news-web.service','/etc/systemd/system/tql-news-web.socket','/www/server/panel/vhost/nginx/tql_news.conf'];
const protectedFiles=['industry/selection.ts','packages/backend/src/providers/x-official.ts','packages/backend/src/providers/x-proxy.ts'];
const hash=p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
const manifest=base+'/v13-before.json',system=(...args)=>execFileSync('systemctl',args,{encoding:'utf8',timeout:240000});
if(fs.realpathSync(base+'/current')!==old)throw Error('Concurrent release');
if(process.argv.includes('--prepare')){
 if(fs.existsSync(next)||fs.existsSync(manifest))throw Error('Already prepared');
 fs.writeFileSync(manifest,JSON.stringify({files:Object.fromEntries(files.map(f=>[f,hash(old+'/'+f)])),configs:Object.fromEntries(configs.map(p=>[p,hash(p)])),protected:Object.fromEntries(protectedFiles.map(f=>[f,hash(old+'/'+f)]))}),{mode:0o600});
 fs.cpSync(old,next,{recursive:true,dereference:false,verbatimSymlinks:true});console.log(JSON.stringify({prepared:next,files}));process.exit(0);
}
if(!process.argv.includes('--publish'))throw Error('Explicit mode required');
const before=JSON.parse(fs.readFileSync(manifest));
for(const [p,h]of Object.entries(before.configs))if(hash(p)!==h)throw Error('Concurrent config: '+p);
for(const f of files){if(hash(old+'/'+f)!==before.files[f])throw Error('Concurrent source: '+f);if(!fs.statSync(next+'/'+f).isFile())throw Error('Missing file: '+f);}
for(const [f,h]of Object.entries(before.protected))if(hash(next+'/'+f)!==h)throw Error('Protected source changed: '+f);
if(!fs.statSync(next+'/apps/web/build/server/index.js').size)throw Error('Missing web build');
const backup=base+'/backups/v13-'+Date.now();fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(manifest,backup+'/before.json');
const point=target=>{const tmp=base+'/current.v13-pending';fs.symlinkSync(target,tmp);fs.renameSync(tmp,base+'/current');};
const prices=mode=>execFileSync('/usr/local/bin/node',['--env-file=/etc/tql-news/app.env',next+'/scripts/price-batch-release-v13.ts',mode],{cwd:next,encoding:'utf8',timeout:180000});
await exec('systemctl',['stop','tql-news-worker'],{timeout:240000});
try{
 const snapshot=prices('--snapshot');fs.writeFileSync(backup+'/price-before-status.json',snapshot,{mode:0o600});
 point(next);system('restart','tql-news-api');
 let healthy=false;for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:9011/api/site/pool?category=prices',{signal:AbortSignal.timeout(2000)});if(r.ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!healthy)throw Error('API health failed');
 const restart=exec('systemctl',['restart','tql-news-web'],{timeout:240000}),statuses=[];
 for(let i=0;i<12;i++){const r=await fetch('http://127.0.0.1:9012/topics',{signal:AbortSignal.timeout(20000)});await r.arrayBuffer();statuses.push(r.status);await new Promise(r=>setTimeout(r,100));}
 await restart;if(statuses.some(s=>s!==200))throw Error('Web status '+statuses);
 const applied=prices('--apply');fs.writeFileSync(backup+'/price-result.json',applied,{mode:0o600});
 system('start','tql-news-worker');system('is-active','tql-news-api','tql-news-worker','tql-news-web','tql-news-web.socket');
 for(const [p,h]of Object.entries(before.configs))if(hash(p)!==h)throw Error('Config changed: '+p);
 console.log(JSON.stringify({published:next,backup,webStatuses:statuses,configPreserved:true,rollback:old,priceResult:JSON.parse(applied)}));
}catch(error){point(old);system('restart','tql-news-api','tql-news-web');system('start','tql-news-worker');console.error('Code reverted. If any price batches committed, preserve their audit and restore presentation with scoped overrides, not a full DB restore.');throw error;}

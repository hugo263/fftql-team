// RSS-only backend overlay. Preserve the existing web build, settings, data, source switches and proxy.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),base='/opt/tql-news';
const old=base+'/releases/20261003-v13-price-mobile',next=base+'/releases/20261003-v14-rss-retry';
const expected={
 'packages/backend/src/lib/http-fetch.ts':'251fe956a8cd6450d54418c334c6ebc232c8c44bf734d4e9411528b086b7ba5e',
 'packages/backend/src/sources/rss.ts':'c03852b37aa334a4a84d88c6c702818b1e82f537b7953c38976b45093c42c403',
 'packages/backend/src/lib/network-retry.ts':null,
 'tests/rss-network-retry.test.ts':null,
};
const configs=['/etc/tql-news/app.env','/etc/tql-news/web.env','/etc/systemd/system/tql-news-api.service','/etc/systemd/system/tql-news-worker.service','/etc/systemd/system/tql-news-web.service','/etc/systemd/system/tql-news-web.socket','/www/server/panel/vhost/nginx/tql_news.conf'];
const protectedFiles=['packages/backend/src/sources/collect.ts','packages/backend/src/providers/x-official.ts','packages/backend/src/providers/x-proxy.ts','industry/selection.ts','apps/web/build/server/index.js'];
const hash=p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
const manifest=base+'/v14-before.json';
const system=(...args)=>exec('systemctl',args,{timeout:240000});
if(fs.realpathSync(base+'/current')!==old)throw Error('Concurrent release');
for(const [f,h]of Object.entries(expected))if(hash(old+'/'+f)!==h)throw Error('Unexpected production source: '+f);
if(process.argv.includes('--prepare')){
 if(fs.existsSync(next)||fs.existsSync(manifest))throw Error('Already prepared');
 fs.writeFileSync(manifest,JSON.stringify({old,next,expected,configs:Object.fromEntries(configs.map(p=>[p,hash(p)])),protected:Object.fromEntries(protectedFiles.map(f=>[f,hash(old+'/'+f)]))}),{mode:0o600});
 fs.cpSync(old,next,{recursive:true,dereference:false,verbatimSymlinks:true});
 console.log(JSON.stringify({prepared:next,files:Object.keys(expected)}));process.exit(0);
}
if(!process.argv.includes('--publish'))throw Error('Explicit mode required');
const before=JSON.parse(fs.readFileSync(manifest));
for(const [p,h]of Object.entries(before.configs))if(hash(p)!==h)throw Error('Concurrent config change: '+p);
for(const [f,h]of Object.entries(before.protected))if(hash(next+'/'+f)!==h)throw Error('Protected file change: '+f);
for(const f of Object.keys(expected))if(!fs.statSync(next+'/'+f).isFile())throw Error('Missing staged file: '+f);
const backup=base+'/backups/v14-'+Date.now();fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.copyFileSync(manifest,backup+'/before.json');
const point=target=>{const tmp=base+'/current.v14-pending';fs.symlinkSync(target,tmp);fs.renameSync(tmp,base+'/current');};
async function healthy(){
 for(let i=0;i<30;i++){
  try{const r=await fetch('http://127.0.0.1:9011/api/health',{signal:AbortSignal.timeout(2000)});if(r.ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }throw Error('API health failed');
}
console.log('Gracefully stopping only the news worker; in-flight provider requests may finish.');
await system('stop','tql-news-worker');
try {
 point(next);await system('restart','tql-news-api');await healthy();await system('start','tql-news-worker');
 await system('is-active','tql-news-api','tql-news-worker','tql-news-web','tql-news-web.socket');
 const r=await fetch('http://127.0.0.1:9012/topics',{signal:AbortSignal.timeout(15000)});await r.arrayBuffer();if(r.status!==200)throw Error('Web health failed');
 for(const [p,h]of Object.entries(before.configs))if(hash(p)!==h)throw Error('Config changed: '+p);
 console.log(JSON.stringify({published:next,backup,rollback:old,configPreserved:true,webRestarted:false,files:Object.fromEntries(Object.keys(expected).map(f=>[f,hash(next+'/'+f)]))}));
}catch(error){
 await system('stop','tql-news-worker');point(old);await system('restart','tql-news-api');await healthy();await system('start','tql-news-worker');throw error;
}

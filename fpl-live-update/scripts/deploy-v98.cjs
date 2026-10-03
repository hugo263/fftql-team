'use strict';
// Remote-only code deployment with optimistic concurrency and automatic rollback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root='/opt/fpl-weekly',stage='/opt/fpl-weekly/releases/v98-20261002',backup=root+'/backups/v98-20261002-'+Date.now();
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run=(cmd,args)=>cp.execFileSync(cmd,args,{stdio:'pipe',encoding:'utf8'}).trim();
const manifest=JSON.parse(fs.readFileSync(stage+'/manifest.json','utf8'));
function allowed(rel){return rel===path.normalize(rel)&&!rel.includes('..')&&/^(public\/|(?:server|site-routing|news-proxy|analytics-report|admin-news-sso)\.js$)/.test(rel);}
function protectedFiles(){const list=[root+'/config.json'];function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(e.isFile())list.push(file);}}scan(root+'/data');return list.map(file=>({file,hash:sha(file)}));}
for(const f of manifest.files){if(!allowed(f.path))throw Error('Invalid target');if(sha(path.join(stage,f.path))!==f.after)throw Error('Staging hash mismatch: '+f.path);const live=path.join(root,f.path);if(f.before?(!fs.existsSync(live)||sha(live)!==f.before):fs.existsSync(live))throw Error('Concurrent production change: '+f.path);}
run('/usr/local/bin/node',['--check',stage+'/server.js']);
fs.mkdirSync(backup,{recursive:false});
for(const f of manifest.files){if(!f.before)continue;const target=path.join(backup,f.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,f.path),target);}
fs.copyFileSync(stage+'/manifest.json',backup+'/manifest.json');
const newsRelease=fs.realpathSync('/opt/tql-news/current');
let stopped=false,modified=false;
async function main(){try{
  run('systemctl',['stop','fpl-weekly']);stopped=true;
  const protectedBefore=protectedFiles();
  fs.writeFileSync(backup+'/protected.json',JSON.stringify(protectedBefore,null,2));
  modified=true;
  for(const f of manifest.files){const live=path.join(root,f.path);fs.mkdirSync(path.dirname(live),{recursive:true});const mode=fs.existsSync(live)?fs.statSync(live).mode&0o777:0o644;fs.copyFileSync(path.join(stage,f.path),live+'.v98-new');fs.chmodSync(live+'.v98-new',mode);fs.renameSync(live+'.v98-new',live);}
  for(const f of protectedBefore)if(sha(f.file)!==f.hash)throw Error('Protected file changed');
  if(fs.realpathSync('/opt/tql-news/current')!==newsRelease)throw Error('News release changed');
  run('systemctl',['start','fpl-weekly']);stopped=false;
  async function ready(url,options={}){let last;for(let i=0;i<20;i++){try{const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});if(response.ok)return response;last=Error('HTTP '+response.status);}catch(error){last=error;}await new Promise(resolve=>setTimeout(resolve,500));}throw last;}
  // Node's current fetch forbids overriding Host. Use the explicit portal
  // route for readiness, then curl with Host for production root routing.
  const response=await ready('http://127.0.0.1:9090/portal');
  if(!response.ok||!(await response.text()).includes('portal.js?v=98'))throw Error('Portal health failed');
  const rootHtml=run('curl',['--fail','--silent','--show-error','--max-time','10','-H','Host: fftql.team','http://127.0.0.1:9090/']);
  if(!rootHtml.includes('portal.js?v=98'))throw Error('Domain route health failed');
  const news=await ready('http://127.0.0.1:9090/api/news/timeline?limit=1');
  if(!news.ok||!Array.isArray((await news.json()).cards))throw Error('News proxy health failed');
  const states=run('systemctl',['is-active','fpl-weekly','tql-news-api','tql-news-web','tql-news-worker']).split('\n');if(states.some(v=>v!=='active'))throw Error('Service inactive');
  const receipt={version:98,at:new Date().toISOString(),backup,files:manifest.files.length,protectedFiles:protectedBefore.length,protectedUnchanged:true,newsRelease,states};
  fs.writeFileSync(stage+'/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}catch(error){if(modified){run('systemctl',['stop','fpl-weekly']);stopped=true;for(const f of manifest.files){const live=path.join(root,f.path);if(f.before)fs.copyFileSync(path.join(backup,f.path),live);else if(fs.existsSync(live))fs.renameSync(live,path.join(stage,'rolled-back-'+f.path.replaceAll('/','-')));}}if(stopped)run('systemctl',['start','fpl-weekly']);throw error;}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

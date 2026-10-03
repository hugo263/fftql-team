import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), base='/opt/tql-news';
const old=base+'/releases/20261002-v8-rss-timeout', next=base+'/releases/20261002-v9-light-mobile';
const vhost='/www/server/panel/vhost/nginx/tql_news.conf', unit='/etc/systemd/system/tql-news-web.service';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:240000});
const system=(...args)=>run('systemctl',args);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(port) {
  for(const path of ['/hot','/daily','/topics','/starred','/prices','/admin/login']) {
    const res=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(15000)}),body=await res.text();
    if(res.status!==200||!body.includes('TQL'))throw Error(`${port}${path}: ${res.status}`);
    if(!path.startsWith('/admin')&&!body.includes('data-public-site="tql"'))throw Error('Missing light shell: '+path);
  }
}
async function restartCheck(service,port){
  const restart=exec('systemctl',['restart',service],{timeout:90000});
  const statuses=[];
  for(let i=0;i<24;i++){
    const res=await fetch(`http://127.0.0.1:${port}/hot`,{signal:AbortSignal.timeout(20000)});
    await res.arrayBuffer();statuses.push(res.status);await sleep(75);
  }
  await restart;
  if(statuses.some(s=>s!==200))throw Error('Restart interruption: '+statuses);
  console.log(JSON.stringify({restartCheck:service,requests:statuses.length,statuses:[...new Set(statuses)]}));
}
if(fs.realpathSync(base+'/current')!==old)throw Error('Concurrent release');
if(hash(vhost)!=='2ff61654f558a758380a6bdd5d4bdee6e7e1518ac5082b8e0b1fef1549a8c800'||hash(unit)!=='5ea06c25ec82e977a82616274dad41a9e06b5a0770e966ebba7327d84ee9fe12')throw Error('Concurrent configuration');
await check(19012);
await restartCheck('tql-news-v9-check',19012);
if(process.argv.includes('--check-only'))process.exit(0);
const backup=base+'/backups/v9-'+Date.now();fs.mkdirSync(backup,{recursive:true});
fs.copyFileSync(vhost,backup+'/nginx.conf');fs.copyFileSync(unit,backup+'/web.service');
const configHashes=Object.fromEntries(['/etc/tql-news/web.env','/etc/tql-news/app.env'].filter(fs.existsSync).map(p=>[p,hash(p)]));
const nginx=()=>{run('/www/server/nginx/sbin/nginx',['-t']);run('/www/server/nginx/sbin/nginx',['-s','reload']);};
const point=target=>{const pending=base+'/current.v9-pending';fs.symlinkSync(target,pending);fs.renameSync(pending,base+'/current');};
const original=fs.readFileSync(vhost,'utf8');
let switched=false;
try {
  // Existing workers finish old connections; all new requests use the already-ready validation instance.
  fs.writeFileSync(vhost,original.replace('http://127.0.0.1:9012','http://127.0.0.1:19012'));nginx();
  // Wait for old nginx workers to stop accepting new connections before handing over 9012.
  await sleep(2500);
  system('stop','tql-news-web');
  point(next);switched=true;
  fs.copyFileSync(next+'/deploy/tql-news/tql-news-web.service',unit);
  fs.copyFileSync(next+'/deploy/tql-news/tql-news-web.socket','/etc/systemd/system/tql-news-web.socket');
  system('daemon-reload');system('enable','--now','tql-news-web.socket');
  await check(9012);await restartCheck('tql-news-web',9012);
  fs.writeFileSync(vhost,original);nginx();
  // Leave the temporary listener through the old proxy workers' drain, then stop it.
  await sleep(5000);
  system('stop','tql-news-v9-check.socket','tql-news-v9-check.service');
  for(const [p,h]of Object.entries(configHashes))if(hash(p)!==h)throw Error('Environment changed: '+p);
  console.log(JSON.stringify({published:next,backup,configPreserved:true,apiAndWorkerNotRestarted:true}));
} catch(error) {
  // Keep requests on the ready isolated instance during rollback.
  system('start','tql-news-v9-check.socket');await check(19012);
  fs.writeFileSync(vhost,original.replace('http://127.0.0.1:9012','http://127.0.0.1:19012'));nginx();
  system('stop','tql-news-web.socket','tql-news-web');
  system('disable','tql-news-web.socket');
  fs.copyFileSync(backup+'/web.service',unit);if(switched)point(old);
  system('daemon-reload');system('start','tql-news-web');
  // Old shell isn't subject to the new-theme check.
  const r=await fetch('http://127.0.0.1:9012/hot',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw error;
  fs.writeFileSync(vhost,original);nginx();throw error;
}

import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base='/opt/tql-news', old=base+'/releases/20261002-v7-admin-redesign', next=base+'/releases/20261002-v8-rss-timeout';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(fs.realpathSync(base+'/current')!==old) throw Error('Concurrent release change');
for(const [file,digest] of Object.entries({
  'packages/backend/src/lib/http-fetch.ts':'1266fcffff058294ea51aef497cf80f85d7b2bf06cca95d1b92eb4f903140219',
  'packages/backend/src/sources/rss.ts':'6c5d1b7f59ab61e91502c7045c693e2417cb80a40fde1f2f36732090ca42d270'
})) if(hash(old+'/'+file)!==digest) throw Error('Concurrent code change: '+file);
const run=(...args)=>execFileSync('systemctl',args,{stdio:'inherit',timeout:240_000});
const point=target=>{const tmp=base+'/current.v8-pending'; fs.symlinkSync(target,tmp);fs.renameSync(tmp,base+'/current');};
console.log('Gracefully stopping news worker; existing paid requests may finish.');
run('stop','tql-news-worker');
try {
  point(next);
  run('restart','tql-news-api','tql-news-web');
  run('start','tql-news-worker');
  for(let i=0;i<10;i++) {
    try {execFileSync('curl',['-fsS','--max-time','8','http://127.0.0.1:9011/api/site/timeline?limit=1'],{stdio:'ignore'});break;}
    catch(error) {if(i===9)throw error;await new Promise(r=>setTimeout(r,1000));}
  }
  run('is-active','tql-news-api','tql-news-web','tql-news-worker');
  console.log(JSON.stringify({status:'published',release:next,rollback:old}));
} catch(error) {
  run('stop','tql-news-worker');point(old);run('restart','tql-news-api','tql-news-web');run('start','tql-news-worker');throw error;
}

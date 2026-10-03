// Explicit static-only deployment; no config/data writes and no application restart.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root='/opt/fpl-weekly',stage=root+'/releases/v101-20261002';
const files=['pitch.js','pitch.css','light-surfaces.css','responsive.css','app.js','match-share.js','home-tab.js','share-styles.js','index.html','portal.html','admin.html','discover.html','share-styles.html'];
const hash=p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
const manifest=stage+'/before.json';
if(process.argv.includes('--prepare')){
  if(fs.existsSync(manifest))throw Error('Release already prepared');
  fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(manifest,JSON.stringify({config:hash(root+'/config.json'),files:Object.fromEntries(files.map(f=>[f,hash(root+'/public/'+f)]))},null,2));
  console.log('Prepared static-only v101');process.exit(0);
}
if(!process.argv.includes('--publish'))throw Error('Explicit mode required');
const before=JSON.parse(fs.readFileSync(manifest));
if(hash(root+'/config.json')!==before.config)throw Error('Configuration changed');
for(const f of files){if(hash(root+'/public/'+f)!==before.files[f])throw Error('Concurrent file change: '+f);if(!fs.statSync(stage+'/'+f).isFile())throw Error('Missing asset: '+f);}
const backup=root+'/backups/v101-'+Date.now();fs.mkdirSync(backup,{recursive:true});
for(const f of files)if(before.files[f])fs.copyFileSync(root+'/public/'+f,backup+'/'+f);
try {
  for(const f of files){const target=root+'/public/'+f;fs.copyFileSync(stage+'/'+f,target+'.v101-pending');fs.renameSync(target+'.v101-pending',target);}
  const html=execFileSync('curl',['-fsS','--max-time','10','-H','Host: fftql.team','http://127.0.0.1:9090/?league=47275'],{encoding:'utf8'});
  if(!html.includes('/responsive.css?v=101.2')||!html.includes('/pitch.js?v=101.2'))throw Error('Verification failed');
  if(hash(root+'/config.json')!==before.config)throw Error('Configuration changed during release');
  console.log(JSON.stringify({status:'published',backup,configPreserved:true,files:Object.fromEntries(files.map(f=>[f,hash(root+'/public/'+f)]))},null,2));
} catch(e){for(const f of files)if(before.files[f])fs.copyFileSync(backup+'/'+f,root+'/public/'+f);throw e;}

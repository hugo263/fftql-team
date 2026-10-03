const fs=require('node:fs'),crypto=require('node:crypto');
const root='/opt/fpl-weekly',stage=root+'/releases/v102-20261003',files=['portal.js','portal.html'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest=stage+'/before.json';
if(process.argv.includes('--prepare')){
  if(fs.existsSync(manifest))throw Error('Already prepared');
  fs.mkdirSync(stage,{recursive:true});fs.writeFileSync(manifest,JSON.stringify({config:hash(root+'/config.json'),files:Object.fromEntries(files.map(f=>[f,hash(root+'/public/'+f)]))}));console.log('Prepared v102');process.exit(0);
}
if(!process.argv.includes('--publish'))throw Error('Explicit mode required');
const before=JSON.parse(fs.readFileSync(manifest));
if(hash(root+'/config.json')!==before.config)throw Error('Concurrent config');
for(const f of files)if(hash(root+'/public/'+f)!==before.files[f])throw Error('Concurrent file: '+f);
const backup=root+'/backups/v102-'+Date.now();fs.mkdirSync(backup,{recursive:true});
for(const f of files)fs.copyFileSync(root+'/public/'+f,backup+'/'+f);
for(const f of files){fs.copyFileSync(stage+'/'+f,root+'/public/'+f+'.v102-pending');fs.renameSync(root+'/public/'+f+'.v102-pending',root+'/public/'+f);}
if(hash(root+'/config.json')!==before.config)throw Error('Config changed');
console.log(JSON.stringify({published:files,backup,configPreserved:true}));

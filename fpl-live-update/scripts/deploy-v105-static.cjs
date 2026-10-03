const fs=require('node:fs'),crypto=require('node:crypto');
const root='/opt/fpl-weekly',stage=root+'/releases/v105-20261003';
// Dependencies first, document entry points last. No config/data/backend replacement.
const files=['pitch.js','pitch.css','light-surfaces.css','responsive.css','news-categories.css','app.js','portal.js','match-centre.js','match-centre-share.js','home-tab.js','share-styles.js','portal-news-model.js','price-bulletin.css','share-styles.html','discover.html','index.html','portal.html'];
const hash=p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null,manifest=stage+'/before.json';
if(process.argv.includes('--prepare')){if(fs.existsSync(manifest))throw Error('Already prepared');fs.mkdirSync(stage,{recursive:true});fs.writeFileSync(manifest,JSON.stringify({config:hash(root+'/config.json'),files:Object.fromEntries(files.map(f=>[f,hash(root+'/public/'+f)]))}));console.log('Prepared v105');process.exit(0);}
if(!process.argv.includes('--publish'))throw Error('Explicit mode required');
const before=JSON.parse(fs.readFileSync(manifest));if(hash(root+'/config.json')!==before.config)throw Error('Concurrent config');
for(const f of files){if(hash(root+'/public/'+f)!==before.files[f])throw Error('Concurrent file: '+f);if(!fs.statSync(stage+'/'+f).isFile())throw Error('Missing file: '+f);}
const backup=root+'/backups/v105-'+Date.now();fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(manifest,backup+'/before.json');
for(const f of files)if(before.files[f])fs.copyFileSync(root+'/public/'+f,backup+'/'+f);
try{for(const f of files){fs.copyFileSync(stage+'/'+f,root+'/public/'+f+'.v105-pending');fs.renameSync(root+'/public/'+f+'.v105-pending',root+'/public/'+f);}}
catch(error){for(const f of files)if(before.files[f])fs.copyFileSync(backup+'/'+f,root+'/public/'+f);throw error;}
if(hash(root+'/config.json')!==before.config)throw Error('Config changed');
console.log(JSON.stringify({published:files,backup,configPreserved:true}));

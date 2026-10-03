// Four-file navigation release. Never touches config/data or restarts the Draft service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = '/opt/fpl-weekly';
const stage = '/opt/fpl-weekly/releases/v99-20261002';
const expected = {
  'portal.html': '05903bf7f7e798b24487e21d2c9b2ae6a87e2bfed5f8febaf5a9371bd1793487',
  'portal.js': 'b05e7de67e6c6c3bb25d581f951ca06b8223e7d0bfd953b4fd4d2a2d1ea27ec6',
  'index.html': '8d2ec9f6eb5b5f8e05daadb89f858511ac8a8e94bb24690017bbc9992c736fd6',
  'share-styles.html': 'abde167766b7aaaf392fec6d7940e297139336b9721f11ec6c9c9edc6d30f7d4'
};
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for (const [file, before] of Object.entries(expected)) {
  if (hash(path.join(root,'public',file)) !== before) throw Error('Concurrent change: '+file);
  if (!fs.statSync(path.join(stage,file)).isFile()) throw Error('Missing staged file: '+file);
}
const backup = path.join(root,'backups','v99-20261002-'+Date.now());
fs.mkdirSync(backup,{recursive:true});
for (const file of Object.keys(expected)) fs.copyFileSync(path.join(root,'public',file),path.join(backup,file));
try {
  // Publish script before its cache-busted template.
  for (const file of ['portal.js','index.html','share-styles.html','portal.html']) {
    const target=path.join(root,'public',file), pending=target+'.v99';
    fs.copyFileSync(path.join(stage,file),pending);fs.renameSync(pending,target);
  }
  const html=execFileSync('curl',['-fsS','--max-time','10','-H','Host: fftql.team','http://127.0.0.1:9090/'],{encoding:'utf8'});
  if (html.includes('>首页</a>') || !html.includes('/portal.js?v=99')) throw Error('Root navigation verification failed');
  console.log(JSON.stringify({status:'published',backup,files:Object.fromEntries(Object.keys(expected).map(file=>[file,hash(path.join(root,'public',file))]))},null,2));
} catch(error) {
  for (const file of Object.keys(expected)) fs.copyFileSync(path.join(backup,file),path.join(root,'public',file));
  throw error;
}

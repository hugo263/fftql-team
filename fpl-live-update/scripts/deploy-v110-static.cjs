const fs = require('node:fs'), crypto = require('node:crypto');
const root = '/opt/fpl-weekly', stage = root + '/releases/v110-20261008';
const files = ['pitch.css','app.js','index.html'];
const reviewedBefore = {
  'app.js':'1cb90571fc5092f5106bf5eee00d6d3a5b105f2729b39ff4ecb45f56b58e76ea',
  'pitch.css':'79703cf74df980293cea72d906d7c897c6dfcdc9d1a39aac3e43fe6436076242',
  'index.html':'5b88fd618a5de07a9b524e6953e97d9b16a1413fdc36fcd0691afb0d7ec9e105',
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = stage + '/before.json';
if (process.argv.includes('--prepare')) {
  if (fs.existsSync(manifest)) throw Error('Already prepared');
  for (const file of files) if (hash(root + '/public/' + file) !== reviewedBefore[file]) throw Error('Production differs from reviewed baseline: ' + file);
  fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(manifest,JSON.stringify({config:hash(root+'/config.json'),files:reviewedBefore}));
  console.log('Prepared v110'); process.exit(0);
}
if (!process.argv.includes('--publish')) throw Error('Explicit mode required');
const before = JSON.parse(fs.readFileSync(manifest));
const expected = JSON.parse(fs.readFileSync(stage + '/expected.json'));
if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify([...files].sort())) throw Error('Unexpected file set');
if (hash(root + '/config.json') !== before.config) throw Error('Concurrent config change');
for (const file of files) {
  if (hash(root + '/public/' + file) !== before.files[file]) throw Error('Concurrent change: ' + file);
  if (hash(stage + '/' + file) !== expected[file]) throw Error('Unexpected staged content: ' + file);
}
const backup = root + '/backups/v110-' + Date.now();
fs.mkdirSync(backup,{recursive:true}); fs.copyFileSync(manifest,backup + '/before.json');
for (const file of files) fs.copyFileSync(root + '/public/' + file,backup + '/' + file);
try {
  for (const file of files) {
    fs.copyFileSync(stage + '/' + file,root + '/public/' + file + '.v110-pending');
    fs.renameSync(root + '/public/' + file + '.v110-pending',root + '/public/' + file);
  }
  for (const file of files) if (hash(root + '/public/' + file) !== expected[file]) throw Error('Published hash mismatch: ' + file);
  if (hash(root + '/config.json') !== before.config) throw Error('Config changed');
} catch (error) {
  for (const file of files) fs.copyFileSync(backup + '/' + file,root + '/public/' + file);
  throw error;
}
console.log(JSON.stringify({published:files,backup,configPreserved:true,restarted:false,hashes:expected}));

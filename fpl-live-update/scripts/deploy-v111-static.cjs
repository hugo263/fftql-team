const fs = require('node:fs'), crypto = require('node:crypto');
const root = '/opt/fpl-weekly', stage = root + '/releases/v111-20261008';
const files = ['pitch.css','app.js','index.html'];
const reviewedBefore = {
  'app.js':'c0079160c9be4cc70cbf565a23cd7c521e1c06bc58a4ffc93cd1482ce60d863c',
  'pitch.css':'423556c8180cfa5d5b739fb71741798293f0d22412b913982e694029fab7069d',
  'index.html':'c0d5d899697d90205615f1a519e67c401226744682291df5ed387be7c567924a',
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = stage + '/before.json';
if (process.argv.includes('--prepare')) {
  if (fs.existsSync(manifest)) throw Error('Already prepared');
  for (const file of files) if (hash(root + '/public/' + file) !== reviewedBefore[file]) throw Error('Production differs from reviewed baseline: ' + file);
  fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(manifest,JSON.stringify({config:hash(root+'/config.json'),files:reviewedBefore}));
  console.log('Prepared v111'); process.exit(0);
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
const backup = root + '/backups/v111-' + Date.now();
fs.mkdirSync(backup,{recursive:true}); fs.copyFileSync(manifest,backup + '/before.json');
for (const file of files) fs.copyFileSync(root + '/public/' + file,backup + '/' + file);
try {
  for (const file of files) {
    fs.copyFileSync(stage + '/' + file,root + '/public/' + file + '.v111-pending');
    fs.renameSync(root + '/public/' + file + '.v111-pending',root + '/public/' + file);
  }
  for (const file of files) if (hash(root + '/public/' + file) !== expected[file]) throw Error('Published hash mismatch: ' + file);
  if (hash(root + '/config.json') !== before.config) throw Error('Config changed');
} catch (error) {
  for (const file of files) fs.copyFileSync(backup + '/' + file,root + '/public/' + file);
  throw error;
}
console.log(JSON.stringify({published:files,backup,configPreserved:true,restarted:false,hashes:expected}));

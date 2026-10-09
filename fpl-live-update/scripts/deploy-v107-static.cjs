const fs = require('node:fs'), crypto = require('node:crypto');
const root = '/opt/fpl-weekly', stage = root + '/releases/v107-20261008';
// Only the reviewed styles, then the document referring to their new versions.
const files = ['news-categories.css', 'portal.css', 'portal.html'];
const reviewedBefore = {
  'portal.html':'adeab4b4ce39d0ad670d7e9441ee2ed6b8b3fea20104dc39e6558db3bdce7bbb',
  'portal.css':'30fcb7b47bc78b3c2e788fb020b48f867a1851f75d826b260d511bbec02408e1',
  'news-categories.css':'91ca8e365b45b3db3ea5442a8b969c29f3a5e312d2f07d53735d1de995bbbb5c',
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = stage + '/before.json';
if (process.argv.includes('--prepare')) {
  if (fs.existsSync(manifest)) throw Error('Already prepared');
  for (const file of files) if (hash(root + '/public/' + file) !== reviewedBefore[file]) throw Error('Production differs from reviewed baseline: ' + file);
  fs.mkdirSync(stage, {recursive:true});
  fs.writeFileSync(manifest, JSON.stringify({config:hash(root + '/config.json'),files:reviewedBefore}));
  console.log('Prepared v107'); process.exit(0);
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
const backup = root + '/backups/v107-' + Date.now();
fs.mkdirSync(backup, {recursive:true});
fs.copyFileSync(manifest, backup + '/before.json');
for (const file of files) fs.copyFileSync(root + '/public/' + file, backup + '/' + file);
try {
  for (const file of files) {
    fs.copyFileSync(stage + '/' + file, root + '/public/' + file + '.v107-pending');
    fs.renameSync(root + '/public/' + file + '.v107-pending', root + '/public/' + file);
  }
  for (const file of files) if (hash(root + '/public/' + file) !== expected[file]) throw Error('Published hash mismatch: ' + file);
  if (hash(root + '/config.json') !== before.config) throw Error('Config changed');
} catch (error) {
  for (const file of files) fs.copyFileSync(backup + '/' + file, root + '/public/' + file);
  throw error;
}
console.log(JSON.stringify({published:files,backup,configPreserved:true,restarted:false,hashes:expected}));

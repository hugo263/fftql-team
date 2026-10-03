'use strict';
// Export existing vector assets verbatim; this does not generate or redesign logos.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.argv[2] || path.join(root, '../fpl-club-icons-20261001'));
if (fs.existsSync(path.join(destination, 'assets'))) throw Error('Archive already exists; will not overwrite it.');
const source = fs.readFileSync(path.join(root, 'public/match-centre.js'), 'utf8');
function object(name) {
  const match = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`));
  if (!match) throw Error(`Original ${name} not found`);
  return vm.runInNewContext(`(${match[1]})`, Object.create(null), { timeout: 100 });
}
const paths = object('markPaths'), clubs = object('clubMarks'), names = object('chineseTeams');
const assets = path.join(destination, 'assets'); fs.mkdirSync(assets, { recursive: true });
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const manifest = [];
for (const [shortName, [motif, background, ink]] of Object.entries(clubs)) {
  const originalPath = paths[motif]; if (!originalPath) throw Error(`Missing motif: ${shortName}`);
  const file = `${shortName}${shortName === 'CHE' ? '-legacy-lion' : ''}.svg`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" width="256" height="256" role="img" aria-labelledby="title"><title id="title">${escape(names[shortName] || shortName)} · TQL 原创简化队标</title><rect width="34" height="34" rx="10" fill="${background}"/><g transform="translate(3 3) scale(.875)" color="${ink}" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round">${originalPath.replaceAll('var(--club)', background)}</g></svg>\n`;
  fs.writeFileSync(path.join(assets, file), svg);
  manifest.push({ shortName, name: names[shortName], motif, background, ink, file,
    displayed: shortName !== 'CHE', sha256: crypto.createHash('sha256').update(svg).digest('hex') });
}
const bus = fs.readFileSync(path.join(root, 'public/brand/chelsea-bus-v74.png'));
fs.writeFileSync(path.join(assets, 'CHE-bus-original.png'), bus);
manifest.push({ shortName: 'CHE', name: names.CHE, motif: 'bus', file: 'CHE-bus-original.png', displayed: true,
  sha256: crypto.createHash('sha256').update(bus).digest('hex') });
fs.writeFileSync(path.join(destination, 'match-centre-before-v90.js'), source);
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ archivedAt: new Date().toISOString(),
  source: 'public/match-centre.js + public/brand/chelsea-bus-v74.png',
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), assets: manifest }, null, 2));
console.log(`Archived ${manifest.length} assets to ${destination}`);

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const archive = path.resolve(__dirname, '../../fpl-club-icons-20261001');
const vault = '/Users/ken/Documents/Personal Asset/Personal Asset';
const noteName = 'FPL Draft 原创队标归档（2026-10-01）.md';
const attachments = path.join(vault, 'Assets/FPL/club-icons-original-2026-10-01');
const note = path.join(vault, 'Resources/FPL', noteName);
if (!fs.statSync(path.join(vault, '.obsidian')).isDirectory()) throw Error('Not the expected Obsidian vault');
if (fs.existsSync(attachments) || fs.existsSync(note)) throw Error('Archive target already exists; refusing to overwrite');
const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const asset of manifest.assets) {
  if (path.basename(asset.file) !== asset.file || hash(path.join(archive, 'assets', asset.file)) !== asset.sha256) throw Error('Asset archive mismatch');
}
if (hash(path.join(archive, 'match-centre-before-v90.js')) !== manifest.sourceSha256) throw Error('Original source mismatch');
fs.mkdirSync(attachments, { recursive: true }); fs.mkdirSync(path.dirname(note), { recursive: true });
for (const asset of manifest.assets) fs.copyFileSync(path.join(archive, 'assets', asset.file), path.join(attachments, asset.file), fs.constants.COPYFILE_EXCL);
for (const file of ['manifest.json', 'match-centre-before-v90.js']) fs.copyFileSync(path.join(archive, file), path.join(attachments, file), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(path.join(archive, noteName), note, fs.constants.COPYFILE_EXCL);
// Re-read only the new files; no existing notes or vault configuration are changed.
for (const asset of manifest.assets) if (hash(path.join(attachments, asset.file)) !== asset.sha256) throw Error('Copied asset mismatch');
console.log(JSON.stringify({ note, attachments, assets: manifest.assets.length, tags: ['FPL','Draft','设计素材','图标','原创队标'] }));

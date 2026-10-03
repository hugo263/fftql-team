'use strict';
// Build-time only: sharp is supplied by the local asset runtime, never required
// by the zero-dependency production server. Pass the approved v2 dark SVG path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/build-favicons.cjs <approved-v2-icon-dark.svg>');
let source = fs.readFileSync(sourcePath);
let svg = source.toString('utf8');
if (!svg.includes('fill="#D9EF9E"') || !svg.includes('fill="#12382A"') || svg.includes('<path') || svg.includes('keep-original-body')) {
  throw new Error('Expected approved v2 original straight-tail icon, not a redesigned or playful-tail proposal');
}
const admin = process.argv.includes('--admin');
if (admin) {
  svg = svg.replaceAll('#D9EF9E', '#F4BB76');
  source = Buffer.from(svg);
}
const background = admin ? '#F4BB76' : '#D9EF9E';
const publicDir = path.resolve(__dirname, admin ? '../public/admin-icons' : '../public');
fs.mkdirSync(publicDir, { recursive: true });
const render = (size, opaque = false) => {
  // Only system-managed home/app icons have a full-bleed lime background. The
  // mark, scale and colours remain identical; browser favicons retain alpha.
  const input = opaque ? Buffer.from(svg.replace(`<rect x="1" y="1" width="62" height="62" rx="14" fill="${background}"/>`, `<rect width="64" height="64" fill="${background}"/>`)) : source;
  return sharp(input, { density: 576 }).resize(size,size).ensureAlpha();
};

function dib(raw, size) {
  const maskStride = Math.ceil(size / 32) * 4;
  const bitmap = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  bitmap.writeUInt32LE(40,0);
  bitmap.writeInt32LE(size,4);
  bitmap.writeInt32LE(size * 2,8);
  bitmap.writeUInt16LE(1,12);
  bitmap.writeUInt16LE(32,14);
  bitmap.writeUInt32LE(size * size * 4 + maskStride * size,20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const input = ((size - 1 - y) * size + x) * 4;
    const output = 40 + (y * size + x) * 4;
    bitmap[output] = raw[input + 2];
    bitmap[output + 1] = raw[input + 1];
    bitmap[output + 2] = raw[input];
    bitmap[output + 3] = raw[input + 3];
    if (raw[input + 3] === 0) bitmap[40 + size * size * 4 + y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return bitmap;
}

(async () => {
  const outputs = [];
  const write = (file, data) => { fs.writeFileSync(path.join(publicDir,file),data); outputs.push({file,bytes:data.length}); };
  for (const size of [16,32,48]) write(`favicon-${size}x${size}.png`,await render(size).png({compressionLevel:9}).toBuffer());
  const master = await render(512).png({compressionLevel:9}).toBuffer();
  write('favicon.png',master);
  if (!admin) write('brand/tql-icon.png',master);
  const touch = await render(180,true).png({compressionLevel:9}).toBuffer();
  write('apple-touch-icon.png',touch);
  write('apple-touch-icon-precomposed.png',touch);
  for (const size of [192,512]) write(`icon-${size}.png`,await render(size,true).png({compressionLevel:9}).toBuffer());
  const frames = [];
  for (const size of [16,32,48]) frames.push({size, data:dib(await render(size).raw().toBuffer(),size)});
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1,2);
  directory.writeUInt16LE(frames.length,4);
  let offset = directory.length;
  frames.forEach((frame,index) => {
    const pos = 6 + index * 16;
    directory[pos] = directory[pos + 1] = frame.size;
    directory.writeUInt16LE(1,pos + 4);
    directory.writeUInt16LE(32,pos + 6);
    directory.writeUInt32LE(frame.data.length,pos + 8);
    directory.writeUInt32LE(offset,pos + 12);
    offset += frame.data.length;
  });
  write('favicon.ico',Buffer.concat([directory,...frames.map(frame=>frame.data)]));
  console.log(JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),outputs},null,2));
})().catch(error=>{ console.error(error); process.exitCode=1; });

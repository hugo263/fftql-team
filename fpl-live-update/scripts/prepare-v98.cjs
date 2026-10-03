'use strict';
// Creates a code-only, difference-reviewed release. Never includes config/data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out='/private/tmp/fpl-v98-release';
const hashes=new Map(fs.readFileSync('/private/tmp/fpl-v98-production-hashes.txt','utf8').split('\n').map(line=>{const m=line.match(/^([a-f0-9]{64})\s+\/opt\/fpl-weekly\/(.+)$/);return m?[m[2],m[1]]:[];}));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=[];
function include(rel){const bytes=fs.readFileSync(path.join(root,rel));if(hashes.get(rel)===hash(bytes))return;files.push({path:rel,before:hashes.get(rel)||null,after:hash(bytes)});}
function scan(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const rel=dir+'/'+e.name;if(e.isDirectory())scan(rel);else if(e.isFile())include(rel);else throw Error('No symlinks allowed');}}
scan('public');
for(const rel of ['server.js','site-routing.js','news-proxy.js','analytics-report.js','admin-news-sso.js'])include(rel);
fs.mkdirSync(out,{recursive:true});
for(const f of files){if(!/^(public\/|(?:server|site-routing|news-proxy|analytics-report|admin-news-sso)\.js$)/.test(f.path))throw Error('Out of scope');const target=path.join(out,f.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,f.path),target);}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:98,createdAt:new Date().toISOString(),files},null,2));
console.log(JSON.stringify({count:files.length,files:files.map(f=>f.path)},null,2));

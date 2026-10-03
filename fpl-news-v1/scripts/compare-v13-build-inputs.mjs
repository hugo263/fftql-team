import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const list=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==='node_modules')continue;const f=path.join(dir,entry.name);if(entry.isDirectory())walk(f);else if(entry.isFile())list.push(f);}}
for(const dir of ['apps/web/app','apps/web/public','packages/contracts/src','industry'])walk(dir);
list.push('apps/web/vite.config.ts','apps/web/react-router.config.ts','apps/web/package.json','package-lock.json');
const hashes=Object.fromEntries(list.filter(f=>fs.existsSync(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const code="const fs=require('fs'),crypto=require('crypto');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const m=JSON.parse(s),diff=[];for(const [f,h]of Object.entries(m)){const p='/opt/tql-news/releases/20261003-v13-price-mobile/'+f;const actual=fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;if(actual!==h)diff.push(f);}console.log(JSON.stringify({checked:Object.keys(m).length,differences:diff}));});";
const result=execFileSync('ssh',['-i','/Users/ken/.ssh/eplens_lighthouse_ed25519','root@124.222.221.150',"node -e '"+code.replaceAll("'","'\\''")+"'"],{input:JSON.stringify(hashes),encoding:'utf8'});
console.log(result);if(JSON.parse(result).differences.length)process.exitCode=1;

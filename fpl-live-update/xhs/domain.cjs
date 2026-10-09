'use strict';
const crypto = require('node:crypto');
class Problem extends Error { constructor(code, status=400) { super(code); this.code=code; this.status=status; } }
const fail = (code, status) => { throw new Problem(code,status); };
const hash = value => crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const id = () => crypto.randomUUID();
const iso = value => new Date(value).toISOString();
function instant(value) {
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))) fail('INVALID_TIMESTAMP');
 return iso(value);
}
function zonedLocal(value, zone) {
 try { new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(); } catch { fail('INVALID_TIMEZONE'); }
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) fail('INVALID_LOCAL_TIME');
 // Enumerate possible offsets instead of silently resolving DST gaps or overlaps.
 const utc=Date.parse(value+'Z'), matches=[];
 if(!Number.isFinite(utc)) fail('INVALID_LOCAL_TIME');
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 for(let offset=-14*60;offset<=14*60;offset+=15) {
  const t=utc-offset*60000;
  if(fmt.format(t).replace(' ','T')===value) matches.push(iso(t));
 }
 if(matches.length!==1) fail(matches.length?'AMBIGUOUS_LOCAL_TIME':'NONEXISTENT_LOCAL_TIME');
 return matches[0];
}
function text(value, max, required=false) {
 if(typeof value!=='string'||value.length>max||(required&&!value.trim())) fail('INVALID_TEXT');
 return value.trim();
}
function safeUrl(value, note=false) {
 if(!value) return '';
 let u;try{u=new URL(value);}catch{fail('INVALID_URL');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash) fail('URL_MUST_BE_PUBLIC_WITHOUT_QUERY');
 if(note&&(!['www.xiaohongshu.com','xiaohongshu.com'].includes(u.hostname)||!/^\/explore\/[a-zA-Z0-9]+$/.test(u.pathname))) fail('INVALID_NOTE_URL');
 return u.href;
}
function payload(raw) {
 if(!raw||typeof raw!=='object') fail('INVALID_CONTENT');
 const type=['image','video'].includes(raw.type)?raw.type:fail('INVALID_TYPE');
 const timezone=text(raw.timezone,80,true);
 const scheduledAt=zonedLocal(raw.localTime,timezone);
 const expiresAt=instant(raw.expiresAt);
 if(expiresAt<=scheduledAt) fail('EXPIRY_BEFORE_SCHEDULE');
 const ids=v=>{if(!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=='string'||! /^[a-f0-9-]{36}$/.test(x)))fail('INVALID_ASSETS');return v;};
 const images=ids(raw.images||[]);
 if(new Set(images).size!==images.length) fail('DUPLICATE_ASSET');
 const topics=raw.topics||[];if(!Array.isArray(topics)||topics.length>100)fail('INVALID_TOPICS');
 const source=text(raw.source||'',2000);
 const isFpl=raw.isFpl!==false;
 const asOf=raw.asOf?instant(raw.asOf):null;
 const freshUntil=raw.freshUntil?instant(raw.freshUntil):null;
 if(isFpl&&(!asOf||!freshUntil||freshUntil<=asOf||asOf>iso(Date.now())))fail('FPL_FRESHNESS_REQUIRED');
 const latePolicy=['pause','within_window'].includes(raw.latePolicy)?raw.latePolicy:'pause';
 const graceSeconds=Number(raw.graceSeconds??60);
 if(!Number.isInteger(graceSeconds)||graceSeconds<0||graceSeconds>86400)fail('INVALID_GRACE');
 const cover=raw.cover?ids([raw.cover])[0]:null, video=raw.video?ids([raw.video])[0]:null;
 return {title:text(raw.title,500,true),body:text(raw.body,50000),topics:topics.map(t=>text(t,100,true)),type,images,cover,video,
  accountId:text(raw.accountId,80,true),source,sourceUrl:safeUrl(raw.sourceUrl),isFpl,asOf,freshUntil,
  localTime:raw.localTime,timezone,scheduledAt,expiresAt,latePolicy,graceSeconds};
}
module.exports={Problem,fail,hash,id,iso,instant,zonedLocal,text,safeUrl,payload};

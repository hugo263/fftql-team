'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');const path=require('node:path');
const {fail,hash,id,iso,payload,text,safeUrl}=require('./domain.cjs');
const {loadRules,validateRules}=require('./rules.cjs');
const TERMINAL=['cancelled','expired','failed','published'];
const EXTERNAL=['submitting','platform_scheduled','reviewing','unknown'];
class Store {
 constructor(dir,{clock=Date.now,allowMock=false,rulesFile,uploadImageMaxBytes=16*1024*1024,uploadVideoMaxBytes=64*1024*1024,storageMaxBytes=2*1024*1024*1024}={}) {
  this.rules=loadRules(rulesFile);this.uploadImageMaxBytes=uploadImageMaxBytes;this.uploadVideoMaxBytes=uploadVideoMaxBytes;this.storageMaxBytes=storageMaxBytes;
  this.dir=path.resolve(dir);this.clock=clock;this.allowMock=allowMock;
  fs.mkdirSync(this.dir,{recursive:true,mode:0o700});fs.chmodSync(this.dir,0o700);
  this.assetsDir=path.join(this.dir,'assets');fs.mkdirSync(this.assetsDir,{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path.join(this.dir,'xhs.sqlite'),{timeout:5000});
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  this.db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  fs.chmodSync(path.join(this.dir,'xhs.sqlite'),0o600);
 }
 now(){return iso(this.clock());}
 get(q,...p){return this.db.prepare(q).get(...p);}
 all(q,...p){return this.db.prepare(q).all(...p);}
 run(q,...p){return this.db.prepare(q).run(...p);}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 event(content,job,event,detail='',actor='admin'){this.run('INSERT INTO xhs_events(content_id,job_id,at,actor,event,detail) VALUES(?,?,?,?,?,?)',content,job,this.now(),actor,event,detail);}
 account(raw){
  if(Object.keys(raw).some(k=>!['id','label','mode','auth','revision'].includes(k)))fail('UNSUPPORTED_ACCOUNT_FIELD');
  const accountId=raw.id||id(),mode=raw.mode||'manual';
  if(!['manual','mock'].includes(mode)||(mode==='mock'&&!this.allowMock))fail('CHANNEL_UNAVAILABLE');
  const auth=raw.auth||'unknown';if(!['unknown','valid','expired'].includes(auth))fail('INVALID_ACCOUNT_STATUS');
  return this.tx(()=>{
   const old=this.get('SELECT * FROM xhs_accounts WHERE id=?',accountId);
   if(old&&old.revision!==raw.revision)fail('STALE_ACCOUNT',409);
   if(old&&old.mode!==mode&&this.get("SELECT j.id FROM xhs_jobs j JOIN xhs_approvals a ON a.id=j.approval_id WHERE a.account_id=? AND j.state NOT IN ('cancelled','expired','failed','published')",accountId))fail('ACCOUNT_IN_USE',409);
   this.run(`INSERT INTO xhs_accounts(id,label,mode,auth,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,mode=excluded.mode,auth=excluded.auth,revision=xhs_accounts.revision+1,checked_at=excluded.checked_at`,accountId,text(raw.label,120,true),mode,auth,auth==='unknown'?null:this.now());
   return this.get('SELECT * FROM xhs_accounts WHERE id=?',accountId);
  });
 }
 assetFile(assetId){if(!/^[a-f0-9-]{36}$/.test(assetId))fail('ASSET_NOT_FOUND',404);return path.join(this.assetsDir,assetId);}
 addAsset(buffer,mime){
  // Server-side resource limits are local policy, not alleged platform limits.
  const max=mime==='video/mp4'?this.uploadVideoMaxBytes:this.uploadImageMaxBytes;
  if(!Buffer.isBuffer(buffer)||buffer.length>max)fail('UPLOAD_TOO_LARGE',413);
  require('./media.cjs').validateMedia(buffer,mime);
  const assetId=id(),file=this.assetFile(assetId);
  fs.writeFileSync(file,buffer,{flag:'wx',mode:0o600});
  try {this.tx(()=>{if(this.get('SELECT coalesce(sum(bytes),0) n FROM xhs_assets').n+buffer.length>this.storageMaxBytes)fail('STORAGE_QUOTA_EXCEEDED',413);this.run('INSERT INTO xhs_assets VALUES(?,?,?,?,?)',assetId,mime,buffer.length,hash(buffer),this.now());});}
  catch(e){fs.unlinkSync(file);throw e;}
  return this.get('SELECT * FROM xhs_assets WHERE id=?',assetId);
 }
 validate(p,{ready=false}={}){
  const a=this.get('SELECT * FROM xhs_accounts WHERE id=?',p.accountId);if(!a)fail('ACCOUNT_NOT_FOUND');
  if(ready&&p.type==='image'&&(!p.images.length||!p.cover||!p.images.includes(p.cover)||p.video))fail('IMAGE_ASSETS_INCOMPLETE');
  if(ready&&p.type==='video'&&(!p.video||!p.cover||p.images.length))fail('VIDEO_ASSETS_INCOMPLETE');
  for(const assetId of [...p.images,p.cover,p.video].filter(Boolean)){
   const row=this.get('SELECT * FROM xhs_assets WHERE id=?',assetId);
   if(!row)fail('ASSET_MISSING');
   if((assetId===p.video)!==row.mime.startsWith('video/'))fail('ASSET_TYPE_MISMATCH');
   let bytes;try{bytes=fs.readFileSync(this.assetFile(assetId));}catch{fail('ASSET_MISSING');}
   if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)fail('ASSET_CHANGED');
  }
  validateRules(this,p);return a;
 }
 current(contentId){
  const c=this.get('SELECT * FROM xhs_contents WHERE id=?',contentId);if(!c)fail('NOT_FOUND',404);
  const v=this.get('SELECT * FROM xhs_versions WHERE content_id=? AND version=?',contentId,c.version);
  return {...c,payload:JSON.parse(v.payload),hash:v.hash};
 }
 active(contentId){return this.get("SELECT * FROM xhs_jobs WHERE content_id=? AND state NOT IN ('cancelled','expired','failed','published') ORDER BY rowid DESC LIMIT 1",contentId);}
 save(raw,contentId,expected){
  const p=payload(raw);this.validate(p);
  return this.tx(()=>{
   let version=1;
   if(contentId){
    const c=this.current(contentId);if(c.version!==expected)fail('STALE_VERSION',409);
    const job=this.active(contentId);
    if(job?.handed_at||job&&EXTERNAL.includes(job.state))fail('CANCEL_PLATFORM_FIRST',409);
    if(this.get("SELECT id FROM xhs_jobs WHERE content_id=? AND state='published'",contentId))fail('PUBLISHED_IMMUTABLE',409);
    if(job){this.run("UPDATE xhs_jobs SET state='cancelled',reason='VERSION_CHANGED',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",this.now(),job.id);this.event(contentId,job.id,'approval_invalidated');}
    version=c.version+1;
    this.run("UPDATE xhs_contents SET version=?,state='draft',changed=0,updated_at=? WHERE id=?",version,this.now(),contentId);
   }else{contentId=id();this.run("INSERT INTO xhs_contents VALUES(?,1,'draft',0,?,?)",contentId,this.now(),this.now());}
   this.run('INSERT INTO xhs_versions VALUES(?,?,?,?,?)',contentId,version,JSON.stringify(p),hash(p),this.now());
   this.event(contentId,null,'version_saved',String(version));return this.detail(contentId);
  });
 }
 requestReview(contentId,version){return this.tx(()=>{
  const c=this.current(contentId);if(c.version!==version||c.state!=='draft')fail('STALE_VERSION_OR_STATE',409);
  this.validate(c.payload,{ready:true});
  this.run("UPDATE xhs_contents SET state='pending',updated_at=? WHERE id=?",this.now(),contentId);
  this.event(contentId,null,'review_requested');return this.detail(contentId);
 });}
 approve(contentId,{version,hash:expectedHash,accountId,scheduledAt,acknowledged}){return this.tx(()=>{
  const c=this.current(contentId),p=c.payload;
  if(c.version!==version||c.hash!==expectedHash||p.accountId!==accountId||p.scheduledAt!==scheduledAt||acknowledged!==true)fail('APPROVAL_BINDING_MISMATCH',409);
  if(c.state!=='pending'||c.changed)fail('NOT_READY_FOR_APPROVAL',409);
  const a=this.validate(p,{ready:true});
  if(p.scheduledAt<=this.now()||p.expiresAt<=this.now())fail('SCHEDULE_IN_PAST');
  if(p.isFpl&&(p.freshUntil<p.scheduledAt||p.freshUntil<=this.now()))fail('FRESHNESS_EXPIRES_BEFORE_SCHEDULE');
  if(a.auth==='expired')fail('ACCOUNT_EXPIRED');
  const approvalId=id(),jobId=id();
  this.run('INSERT INTO xhs_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)',approvalId,contentId,c.version,c.hash,a.id,a.revision,this.rules?.accountId===a.id?this.rules.digest:null,p.scheduledAt,p.timezone,this.now(),'admin');
  this.event(contentId,jobId,'approved',c.hash);
  this.run(`INSERT INTO xhs_jobs(id,approval_id,content_id,version,mode,state,due_at,scheduled_at,expires_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?)`,jobId,approvalId,contentId,c.version,a.mode,p.scheduledAt,p.scheduledAt,p.expiresAt,this.now());
  this.run("UPDATE xhs_contents SET state='queued',updated_at=? WHERE id=?",this.now(),contentId);
  this.event(contentId,jobId,'scheduled',p.scheduledAt);return this.detail(contentId);
 });}
 setState(job,state,reason=null){
  this.run('UPDATE xhs_jobs SET state=?,reason=?,updated_at=? WHERE id=?',state,reason,this.now(),job.id);
  this.run('UPDATE xhs_contents SET state=?,updated_at=? WHERE id=?',state,this.now(),job.content_id);
 }
 cancel(contentId){return this.tx(()=>{
  const job=this.active(contentId);if(!job)fail('NO_ACTIVE_JOB',409);
  if(job.handed_at||EXTERNAL.includes(job.state)){
   this.run('UPDATE xhs_jobs SET cancel_requested=1,due_at=?,reason=? WHERE id=?',this.now(),'CANCEL_PENDING_CONFIRMATION',job.id);
   this.event(contentId,job.id,'cancellation_requested');
  }else{this.setState(job,'cancelled','CANCELLED_BEFORE_HANDOFF');this.run('UPDATE xhs_jobs SET lease_token=NULL,lease_until=NULL WHERE id=?',job.id);this.event(contentId,job.id,'cancelled');}
  return this.detail(contentId);
 });}
 flagChanged(contentId){return this.tx(()=>{
  this.current(contentId);this.run('UPDATE xhs_contents SET changed=1,updated_at=? WHERE id=?',this.now(),contentId);
  const job=this.active(contentId);
  if(job?.handed_at){this.run('UPDATE xhs_jobs SET cancel_requested=1,due_at=?,reason=? WHERE id=?',this.now(),'SOURCE_CHANGED_CANCEL_REQUIRED',job.id);}
  else if(job){this.setState(job,'manual_required','SOURCE_CHANGED');this.run('UPDATE xhs_jobs SET lease_token=NULL,lease_until=NULL WHERE id=?',job.id);}
  this.event(contentId,job?.id||null,'source_changed');return this.detail(contentId);
 });}
 detail(contentId){
  const c=this.current(contentId);
  return {...c,jobs:this.all('SELECT * FROM xhs_jobs WHERE content_id=? ORDER BY rowid DESC',contentId).map(({lease_token,...j})=>j),
   versions:this.all('SELECT version,hash,created_at FROM xhs_versions WHERE content_id=? ORDER BY version DESC',contentId),
   events:this.all('SELECT * FROM xhs_events WHERE content_id=? ORDER BY id DESC LIMIT 200',contentId)};
 }
 list(){return this.all('SELECT id FROM xhs_contents ORDER BY updated_at DESC LIMIT 500').map(x=>this.current(x.id));}
 close(){this.db.close();}
}
module.exports={Store,TERMINAL,EXTERNAL};

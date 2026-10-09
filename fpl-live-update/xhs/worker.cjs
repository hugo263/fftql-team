'use strict';
const path=require('node:path');
const {Store}=require('./store.cjs');
const {id,iso,hash,safeUrl,fail,Problem}=require('./domain.cjs');
const {adapterFor}=require('./adapters.cjs');
const LEASE_MS=45000, TIMEOUT_MS=15000, MAX_ATTEMPTS=3, MAX_CHECKS=6;
function recover(s){return s.tx(()=>{
 const jobs=s.all('SELECT * FROM xhs_jobs WHERE lease_token IS NOT NULL AND lease_until<=?',s.now());
 for(const j of jobs){
  if(j.handed_at){s.setState(j,'unknown','WORKER_LOST_AFTER_HANDOFF');}
  else if(j.state==='queued'){s.setState(j,'queued','WORKER_RECOVERED');}
  s.run('UPDATE xhs_jobs SET lease_token=NULL,lease_until=NULL,action=NULL,due_at=? WHERE id=?',s.now(),j.id);
  s.event(j.content_id,j.id,'lease_recovered',j.handed_at?'query_only':'safe_to_claim','worker');
 }
 return jobs.length;
});}
function claim(s){return s.tx(()=>{
 const j=s.get(`SELECT * FROM xhs_jobs WHERE lease_token IS NULL AND due_at<=? AND (
 state='queued' OR (state IN ('platform_scheduled','reviewing','unknown') AND query_failures<?) OR
 (cancel_requested=1 AND state NOT IN ('cancelled','published','failed') AND query_failures<?)) ORDER BY due_at,rowid LIMIT 1`,s.now(),MAX_CHECKS,MAX_CHECKS);
 if(!j)return null;
 const action=j.cancel_requested?'cancel':j.state==='queued'?'submit':'query';
 const token=id();s.run('UPDATE xhs_jobs SET lease_token=?,lease_until=?,action=? WHERE id=?',token,iso(s.clock()+LEASE_MS),action,j.id);
 return {...j,lease_token:token,action};
});}
function begin(s,j){return s.tx(()=>{
 const live=s.get('SELECT * FROM xhs_jobs WHERE id=? AND lease_token=?',j.id,j.lease_token);
 if(!live)return false;
 if(j.action!=='submit'){
  const c=s.current(j.content_id),p=c.payload;
  if(j.action==='query'&&live.state==='platform_scheduled'&&(c.changed||p.expiresAt<=s.now()||(p.isFpl&&p.freshUntil<=s.now()))){
   s.run("UPDATE xhs_jobs SET cancel_requested=1,reason='VALIDITY_CHANGED_CANCEL_REQUIRED' WHERE id=?",j.id);
   j.action='cancel';
  }
  return true;
 }
 if(live.state!=='queued'||live.cancel_requested)return false;
 const c=s.current(j.content_id),a=s.get('SELECT * FROM xhs_approvals WHERE id=?',j.approval_id),p=c.payload;
 let reason=null,state='manual_required';
 if(j.expires_at<=s.now()){reason='CONTENT_EXPIRED';state='expired';}
 else if(c.version!==j.version||hash(p)!==a.hash||c.changed)reason='APPROVAL_INVALIDATED';
 else if((s.rules?.accountId===p.accountId?s.rules.digest:null)!==a.rules_hash)reason='PLATFORM_RULES_CHANGED';
 else if(p.isFpl&&p.freshUntil<=s.now())reason='FPL_RECONFIRM_REQUIRED';
 else if(p.latePolicy==='pause'&&s.clock()>Date.parse(j.scheduled_at)+p.graceSeconds*1000)reason='MISSED_TIME_PAUSED';
 else {
  try {
   const account=s.validate(p,{ready:true});
   if(account.auth==='expired')reason='ACCOUNT_EXPIRED';
   else if(account.revision!==a.account_revision)reason='ACCOUNT_CHANGED_RECONFIRM';
   else if(j.mode==='mock'&&!s.allowMock)reason='CHANNEL_DISABLED';
  }catch(e){reason=e instanceof Problem?e.code:'ASSET_CHECK_FAILED';}
 }
 if(reason){s.setState(j,state,reason);s.run('UPDATE xhs_jobs SET lease_token=NULL,lease_until=NULL,action=NULL WHERE id=?',j.id);s.event(j.content_id,j.id,'dispatch_paused',reason,'worker');return false;}
 // Durable intent precedes the external call. A crash from here requires reconciliation.
 s.setState(j,'submitting');
 s.run('UPDATE xhs_jobs SET handed_at=?,attempts=attempts+1 WHERE id=?',s.now(),j.id);
 s.event(j.content_id,j.id,'submission_started','','worker');return true;
});}
const allowedReasons=new Set(['MANUAL_HANDOFF_REQUIRED','MANUAL_VERIFICATION_REQUIRED','PLATFORM_CANCELLATION_UNCONFIRMED','NO_RECEIPT','ACCOUNT_EXPIRED','VERIFICATION_REQUIRED','SAFE_RETRY','REJECTED','TIMEOUT_OR_DISCONNECT','INVALID_RECEIPT','OFFICIAL_CHANNEL_UNVERIFIED']);
function result(s,j,r,actor='worker') {return s.tx(()=>{
 const live=s.get('SELECT * FROM xhs_jobs WHERE id=? AND lease_token=?',j.id,j.lease_token);
 if(!live)return false; // stale worker is fenced from state mutation, never given a second submission.
 const states=['platform_scheduled','reviewing','published','cancelled','unknown','manual_required','failed','retry'];
 if(!r||!states.includes(r.state))r={state:'unknown',reason:'INVALID_RECEIPT'};
 let state=r.state, reason=allowedReasons.has(r.reason)?r.reason:null;
 const evidence=actor==='admin'?'manual':j.mode==='mock'?'mock':r.evidence==='platform'?'platform':null;
 if(['platform_scheduled','reviewing','published','cancelled'].includes(state)&&(!evidence||(!r.platformId&&state!=='cancelled'))) {state='unknown';reason='INVALID_RECEIPT';}
 let platformId=null,noteUrl=null;
 if(r.platformId&&/^[a-zA-Z0-9_-]{1,120}$/.test(r.platformId))platformId=r.platformId;
 else if(r.platformId){state='unknown';reason='INVALID_RECEIPT';}
 try {noteUrl=r.noteUrl?safeUrl(r.noteUrl,true):null;}catch{state='unknown';reason='INVALID_RECEIPT';}
 if(state==='published'&&evidence!=='mock'&&!noteUrl){state='unknown';reason='INVALID_RECEIPT';}
 // Only a typed, positive proof of no acceptance permits retry. Transport errors never qualify.
 if(state==='retry'){
  if(r.definitelyNotAccepted!==true||j.action!=='submit'){state='unknown';reason='INVALID_RECEIPT';}
  else if(live.cancel_requested){state='cancelled';reason=null;}
  else if(live.attempts>=MAX_ATTEMPTS){state='failed';reason='REJECTED';}
  else{state='queued';reason='SAFE_RETRY';}
 }
 if(state==='cancelled'&&j.action!=='cancel'&&r.definitelyNotAccepted!==true){state='unknown';reason='INVALID_RECEIPT';}
 if(state==='failed'&&r.definitelyNotAccepted!==true){state='unknown';reason='INVALID_RECEIPT';}
 const noHandoff=state==='queued'||(state==='manual_required'&&r.reason==='MANUAL_HANDOFF_REQUIRED')||(state==='failed'&&r.definitelyNotAccepted===true);
 if(noHandoff&&live.cancel_requested){state='cancelled';reason=null;}
 const checks=j.action==='submit'?live.checks:live.checks+1;
 const failures=state==='unknown'?live.query_failures+1:0;
 const due=iso(s.clock()+(state==='queued'?Math.min(300000,1000*2**live.attempts):30000));
 s.setState(j,state,reason);
 s.run(`UPDATE xhs_jobs SET lease_token=NULL,lease_until=NULL,action=NULL,checks=?,query_failures=?,due_at=?,
  handed_at=CASE WHEN ? THEN NULL ELSE handed_at END,
  platform_id=COALESCE(?,platform_id),note_url=COALESCE(?,note_url),receipt_kind=COALESCE(?,receipt_kind) WHERE id=?`,
 checks,failures,live.cancel_requested&&state!=='cancelled'&&j.action==='submit'?s.now():due,noHandoff?1:0,platformId,noteUrl,evidence,j.id);
 s.event(j.content_id,j.id,'receipt_'+state,reason||evidence||'',actor);
 if(failures>=MAX_CHECKS&&['unknown','platform_scheduled','reviewing'].includes(state)){
  s.run("UPDATE xhs_jobs SET reason='RECONCILIATION_LIMIT_MANUAL' WHERE id=?",j.id);
  s.event(j.content_id,j.id,'manual_verification_required','RECONCILIATION_LIMIT_MANUAL','worker');
 }
 return true;
});}
async function tick(s,{adapter,timeoutMs=TIMEOUT_MS}={}){
 recover(s);const j=claim(s);if(!j)return false;
 if(!begin(s,j))return true;
 const impl=adapter||adapterFor(s,j.mode);let timer;
 try{
  const controller=new AbortController();
  const output=await Promise.race([
   Promise.resolve().then(()=>impl[j.action](j,s.current(j.content_id).payload,{signal:controller.signal})),
   new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({state:'unknown',reason:'TIMEOUT_OR_DISCONNECT'});},timeoutMs);})
  ]);
  result(s,j,output);
 }catch{result(s,j,{state:'unknown',reason:'TIMEOUT_OR_DISCONNECT'});}
 finally{clearTimeout(timer);}
 return true;
}
function manualReceipt(s,contentId,input){
 let j=s.tx(()=>{
  const j=s.active(contentId);if(!j||j.id!==input.jobId||j.mode!=='manual'||j.lease_token)fail('JOB_NOT_MANUALLY_RECONCILABLE',409);
  if(!['manual_required','unknown','platform_scheduled','reviewing'].includes(j.state))fail('INVALID_RECEIPT_STATE',409);
  if(input.version!==j.version||input.acknowledged!==true)fail('RECEIPT_BINDING_MISMATCH');
  if(!['platform_scheduled','reviewing','published','cancelled','unknown'].includes(input.state))fail('INVALID_RECEIPT_STATE');
  if(input.state==='cancelled'&&!j.cancel_requested)fail('CANCELLATION_NOT_REQUESTED');
  if(!j.handed_at&&s.current(contentId).changed)fail('SOURCE_CHANGED');
  const token=id();s.run('UPDATE xhs_jobs SET lease_token=?,lease_until=?,handed_at=COALESCE(handed_at,?) WHERE id=?',token,iso(s.clock()+LEASE_MS),s.now(),j.id);
  return {...j,lease_token:token,action:input.state==='cancelled'?'cancel':'query'};
 });
 result(s,j,{state:input.state,platformId:input.platformId,noteUrl:input.noteUrl,evidence:'manual'},'admin');
 return s.detail(contentId);
}
if(require.main===module){
 if(process.env.XHS_ENABLED!=='1'){console.log('XHS worker disabled');process.exit(0);}
 if(!process.env.XHS_DATA_DIR)throw new Error('XHS_DATA_DIR_REQUIRED');
 const s=new Store(process.env.XHS_DATA_DIR,{allowMock:process.env.XHS_ALLOW_MOCK==='1',rulesFile:process.env.XHS_RULES_FILE});
 let stopped=false;for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopped=true;});
 (async()=>{while(!stopped){try{await tick(s);}catch{console.error('XHS_WORKER_TICK_FAILED');}if(!stopped)await new Promise(r=>setTimeout(r,1000));}s.close();})().catch(()=>{console.error('XHS_WORKER_STOPPED');process.exitCode=1;});
}
module.exports={tick,recover,claim,begin,result,manualReceipt,LEASE_MS,MAX_CHECKS};

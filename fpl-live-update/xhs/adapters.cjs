'use strict';
// No network client or browser automation is shipped in this release.
// Adapters must return evidence, never infer publication from a successful click.
class ManualAdapter {
 async submit(){return {state:'manual_required',reason:'MANUAL_HANDOFF_REQUIRED'};}
 async query(){return {state:'unknown',reason:'MANUAL_VERIFICATION_REQUIRED'};}
 async cancel(){return {state:'unknown',reason:'PLATFORM_CANCELLATION_UNCONFIRMED'};}
}
class OfficialAdapter {
 async submit(){throw new Error('OFFICIAL_CHANNEL_UNVERIFIED');}
 async query(){return {state:'unknown',reason:'OFFICIAL_CHANNEL_UNVERIFIED'};}
 async cancel(){return {state:'unknown',reason:'OFFICIAL_CHANNEL_UNVERIFIED'};}
}
class MockAdapter {
 constructor(store){this.store=store;}
 async submit(job){
  this.store.run("INSERT OR IGNORE INTO xhs_mock_receipts(job_id,state) VALUES(?,'platform_scheduled')",job.id);
  return {state:'platform_scheduled',platformId:'mock-'+job.id,evidence:'mock'};
 }
 async query(job){
  const s=this.store;const receipt=s.get('SELECT * FROM xhs_mock_receipts WHERE job_id=?',job.id);
  if(!receipt)return {state:'unknown',reason:'NO_RECEIPT'};
  if(receipt.state==='cancelled')return {state:'cancelled',platformId:'mock-'+job.id,evidence:'mock'};
  const state=s.now()<job.scheduled_at?'platform_scheduled':receipt.queries===0?'reviewing':'published';
  s.run('UPDATE xhs_mock_receipts SET state=?,queries=queries+1 WHERE job_id=?',state,job.id);
  return {state,platformId:'mock-'+job.id,evidence:'mock'};
 }
 async cancel(job){this.store.run("UPDATE xhs_mock_receipts SET state='cancelled' WHERE job_id=?",job.id);return {state:'cancelled',evidence:'mock',platformId:'mock-'+job.id};}
}
function adapterFor(store,mode){
 if(mode==='manual')return new ManualAdapter();
 if(mode==='mock'&&store.allowMock)return new MockAdapter(store);
 return new OfficialAdapter();
}
module.exports={ManualAdapter,OfficialAdapter,MockAdapter,adapterFor};

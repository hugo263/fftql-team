'use strict';
const fs=require('node:fs'),path=require('node:path');const {Store}=require('./store.cjs');
if(process.argv[2]!=='--writers-stopped'||!process.argv[3])throw Error('Usage: node xhs/quarantine-after-restore.cjs --writers-stopped DATA_DIR');
if(!fs.existsSync(path.join(process.argv[3],'xhs.sqlite')))throw Error('SOURCE_DATABASE_MISSING');
const s=new Store(process.argv[3]);
try{s.tx(()=>{for(const j of s.all("SELECT * FROM xhs_jobs WHERE state NOT IN ('published','cancelled','expired','failed')")){
 s.setState(j,'unknown','RESTORED_SNAPSHOT_RECONCILE_REQUIRED');
 s.run('UPDATE xhs_jobs SET handed_at=COALESCE(handed_at,?),lease_token=NULL,lease_until=NULL,action=NULL,query_failures=6 WHERE id=?',s.now(),j.id);
 s.event(j.content_id,j.id,'restore_quarantined','','operator');
}});console.log('XHS_RESTORED_JOBS_QUARANTINED');}finally{s.close();}

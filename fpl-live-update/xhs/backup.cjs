'use strict';
// Consistent offline backup: stop API writes and worker first; destination must be new.
const fs=require('node:fs'),path=require('node:path');const {backup}=require('node:sqlite');const {Store}=require('./store.cjs');
async function main(){
 if(process.argv[2]!=='--writers-stopped')throw Error('STOP_API_WRITES_AND_WORKER_FIRST');
 const [dir,dest]=process.argv.slice(3);if(!dir||!dest)throw Error('Usage: node xhs/backup.cjs --writers-stopped DATA_DIR NEW_BACKUP_DIR');
 if(!fs.existsSync(path.join(dir,'xhs.sqlite')))throw Error('SOURCE_DATABASE_MISSING');
 fs.mkdirSync(dest,{mode:0o700});const s=new Store(dir);
 try{await backup(s.db,path.join(dest,'xhs.sqlite'));fs.cpSync(s.assetsDir,path.join(dest,'assets'),{recursive:true,errorOnExist:true,force:false});fs.chmodSync(path.join(dest,'xhs.sqlite'),0o600);}
 finally{s.close();}
 console.log('XHS_BACKUP_COMPLETE');
}
main().catch(()=>{console.error('XHS_BACKUP_FAILED');process.exitCode=1;});

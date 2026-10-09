// Bounded correction for the user's two examples. Run only with an explicit release instruction.
import fs from 'node:fs';
import {sql,closeDb} from '@aihot/backend/db';
import {setVisibility} from '@aihot/backend/admin/content';
import {stopBoss} from '@aihot/backend/jobs/queue';
const ids=['xsbkgjmr7esilv9wghxs4eubc','t3naknr6wlg0iodfbvi6bqeu2'];
const actor='fpl-scope-v15-user-review',dir='/opt/tql-news/backups/fpl-scope-v15-20261007',manifest=dir+'/before.json';
const rows=()=>sql`SELECT a.id,a.revision,a.source_id,a.title,a.body_text,
  p.visibility,p.eligible,p.selected,p.fact_id,p.story_id,o.version AS override_version,o.fields,o.visibility AS override_visibility
  FROM articles a LEFT JOIN publications p ON p.article_id=a.id
  LEFT JOIN editorial_overrides o ON o.article_id=a.id WHERE a.id=ANY(${ids}) ORDER BY a.id`;
const reason='按用户核查：赫塔菲与卡瓦哈尔的西甲内部转会，原文无英超球员、英超俱乐部或英格兰足球关联；两条为同一事件的重复发帖。撤下公开展示，保留原文和审核记录。';
try{
  if(process.argv.includes('--snapshot')){
    if(fs.existsSync(manifest))throw Error('Snapshot already exists');
    const before=await rows();if(before.length!==ids.length)throw Error('Review population changed');
    for(const row of before)if(row.source_id!=='x-fabrizio-romano'||!row.body_text?.includes('Getafe')||!row.body_text?.includes('Carvajal')||!row.body_text?.includes('La Liga'))throw Error('Unexpected source material: '+row.id);
    fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(manifest,JSON.stringify({at:new Date(),rows:before},null,2),{mode:0o600});
    console.log(JSON.stringify({snapshot:manifest,count:before.length}));
  }else if(process.argv.includes('--apply')){
    const snapshot=JSON.parse(fs.readFileSync(manifest,'utf8'));
    // Preflight the entire population before starting the audited, individually versioned operations.
    const current=await rows();if(current.length!==ids.length)throw Error('Review population changed');
    const pending=[];
    for(const row of current){
      const before=snapshot.rows.find((r:{id:string})=>r.id===row.id);
      if(!before||row.revision!==before.revision||row.body_text!==before.body_text)throw Error('Source changed: '+row.id);
      const [done]=await sql`SELECT 1 FROM audit_log WHERE actor=${actor} AND subject=${'content:'+row.id} AND action='content.visibility'`;
      if(done){if(row.visibility!=='withdrawn')throw Error('Correction superseded: '+row.id);continue;}
      if(Number(row.override_version??0)!==Number(before.override_version??0))throw Error('Concurrent correction: '+row.id);
      pending.push(row);
    }
    for(const row of pending){await setVisibility(row.id,{visibility:'withdrawn',reason,version:Number(row.override_version??0)},actor);console.log(JSON.stringify({id:row.id,action:'withdrawn'}));}
  }else if(!process.argv.includes('--status'))throw Error('Explicit mode required');
  console.log(JSON.stringify({rows:(await rows()).map(r=>({id:r.id,visibility:r.visibility,eligible:r.eligible,selected:r.selected}))}));
}finally{await stopBoss();await closeDb();}

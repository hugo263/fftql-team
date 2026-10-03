// One bounded editorial reprocessing run. No source/budget/credential settings are changed.
import fs from 'node:fs';
import {sql,closeDb} from '@aihot/backend/db';
import {rerun,overrideFields} from '@aihot/backend/admin/content';
import {fetchNow} from '@aihot/backend/admin/sources';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {xCollectionState} from '@aihot/backend/sources/x-control';
import {loadAnalyzeInput,runAnalysis,normalizeAnalysis} from '@aihot/backend/editorial/analyze';
import {processArticle} from '@aihot/backend/jobs/content';
import {BudgetExceededError} from '@aihot/backend/providers/receipts';
const dir='/opt/tql-news/backups/editorial-v10-20261003',manifest=dir+'/articles.json',actor='release-v10-editorial';
const focus=['c5h0ge7cxrzy5tunt84o304hc','s3xsnuc7si6atvt4af4dytmjv','dt09603fqf2h1wteraadx7msj'];
try{
  if(process.argv.includes('--snapshot')){
    if(fs.existsSync(manifest))throw Error('Snapshot exists');
    const rows=await sql`SELECT a.id,a.source_id,a.url,a.title,a.revision,a.body_text,a.body_html,a.processing_state,p.title AS public_title,p.summary,p.selected,p.tags,p.eligible FROM articles a LEFT JOIN publications p ON p.article_id=a.id WHERE a.source_id IN ('rss-ffscout','rss-allaboutfpl') ORDER BY a.discovered_at DESC`;
    if(rows.length>50||rows.length<3)throw Error('Unexpected reprocessing population');
    fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(manifest,JSON.stringify({at:new Date(),x:await xCollectionState(),rows},null,2),{mode:0o600});
    console.log(JSON.stringify({snapshot:manifest,count:rows.length}));
  }else if(process.argv.includes('--calibrate')){
    // User-labelled positive examples, same budgeted scoring path; no publication or threshold edits.
    for(const id of focus){const a=await loadAnalyzeInput(id);if(!a)throw Error('Missing sample');const r=await runAnalysis(a,{stages:'selection'});const n=normalizeAnalysis(r);console.log(JSON.stringify({id,scores:n.scores,selected:n.selected,details:r.scores?.details,receipts:r.scores?.receiptIds}));}
  }else if(process.argv.includes('--queue')){
    const snapshot=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(JSON.stringify(await xCollectionState())!==JSON.stringify(snapshot.x))throw Error('X switch changed concurrently');
    // Prioritise the user's examples; the rest follows through the ordinary worker queues.
    const rows=snapshot.rows.sort((a:{id:string},b:{id:string})=>(focus.includes(a.id)?0:1)-(focus.includes(b.id)?0:1));
    for(const row of rows){
      const requestId=`v10-editorial-${row.id}`;
      const [done]=await sql`SELECT 1 FROM audit_log WHERE actor=${actor} AND subject=${'content:'+row.id} AND after->>'requestId'=${requestId}`;
      if(done){console.log(JSON.stringify({id:row.id,status:'already-queued'}));continue;}
      const result=await rerun(row.id,row.source_id==='rss-ffscout'?'extract':'analyze',requestId,actor);
      console.log(JSON.stringify({id:row.id,...result}));
    }
    for(const id of ['rss-ffscout','rss-allaboutfpl']){
      const [done]=await sql`SELECT 1 FROM audit_log WHERE actor=${actor} AND action='source.fetch' AND subject=${'source:'+id}`;
      if(!done)console.log(JSON.stringify({source:id,...await fetchNow(id,actor)}));
    }
  }else if(process.argv.includes('--focus')){
    for(const id of focus){
      for(let attempt=0;attempt<6;attempt++){
        try{console.log(JSON.stringify({id,...await processArticle(id)}));break;}
        catch(error){
          if(!(error instanceof BudgetExceededError)||error.retryAfterSeconds>60||attempt===5)throw error;
          console.log(JSON.stringify({id,status:'waiting-for-existing-budget',seconds:error.retryAfterSeconds}));
          await new Promise(resolve=>setTimeout(resolve,error.retryAfterSeconds*1000));
        }
      }
    }
  }else if(process.argv.includes('--review-focus')){
    // Human-readable corrections checked against the stored public source, not private/member content.
    const edits=[
      {id:focus[0]!,fields:{title:'FPL 推出第二机会联赛：10 月 10 日开始，现有经理自动加入',summary:'据 Fantasy Football Scout 报道，FPL 官方宣布“第二机会”联赛于 10 月 10 日开始，现有经理自动以零分加入，不影响其他联赛中已有的积分。错过赛季开局的新玩家也可注册并组建 15 人阵容参赛；赛季末冠军可获得英超比赛门票及旅行套餐。',tags:['规则与公告','Classic','媒体报道']}},
      {id:focus[1]!,fields:{summary:"Christos Tzolis 代表希腊出战时疑似腘绳肌受伤，媒体预计缺阵 2–3 周，恢复时间尚非官方确认；Nico O'Reilly 已退出英格兰队并返回曼城进一步评估。Vitalii Mykolenko 将缺席乌克兰对阵北爱尔兰的比赛，Anan Khalaili 的伤势仍待检查；这些国家队更新不等于已确认下一轮英超能否出场。",tags:['伤停与复出','通用','媒体报道','曼城','球员:Tzolis',"球员:O'Reilly",'球员:Mykolenko','球员:Khalaili']}},
      {id:focus[2]!,fields:{title:'GW6 中场比较：Schade、Barnes 与 Tavernier 的公开数据',summary:'公开部分显示，前五轮 Schade 与 Tavernier 均以 13 次射门取得 3 球，禁区射门分别为 12 次和 8 次，xG 分别为 1.52 和 1.70；Barnes 则有 8 次射门、1 球和 0.62 xG。后续助攻分析属于会员内容，本摘要不推断该部分数据或最终选人结论。',tags:['公开部分摘要','球员与选人分析','Classic','媒体报道','GW6','球员:Schade','球员:Barnes','球员:Tavernier']}}
    ];
    for(const edit of edits){
      const [done]=await sql`SELECT 1 FROM audit_log WHERE actor=${actor+'-review'} AND subject=${'content:'+edit.id} AND action='content.override'`;
      if(done)continue;
      const [current]=await sql`SELECT version FROM editorial_overrides WHERE article_id=${edit.id}`;
      await overrideFields(edit.id,{fields:edit.fields,version:current?.version??0,reason:'用户指定三条正向样本，核对公开正文后修正：代表国家队/对阵关系、公告适用人群、公开数据与会员边界；不改精选分数。'},actor+'-review');
      console.log(JSON.stringify({reviewed:edit.id}));
    }
  }else if(process.argv.includes('--rss-retry')){
    console.log(JSON.stringify(await fetchNow('rss-allaboutfpl',actor+'-retry')));
  }else if(process.argv.includes('--material')){
    const rows=await sql`SELECT id,title,body_status,body_text FROM articles WHERE id=ANY(${focus})`;
    console.log(JSON.stringify(rows));
  }else if(process.argv.includes('--status')){
    const snapshot=JSON.parse(fs.readFileSync(manifest,'utf8')),ids=snapshot.rows.map((r:{id:string})=>r.id);
    const rows=await sql`SELECT a.id,a.processing_state,a.processing_error,a.revision,p.eligible,p.selected,p.title,p.summary,p.tags,an.score,an.created_at AS analyzed_at,an.output FROM articles a LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN LATERAL (SELECT score,created_at,output FROM analyses WHERE article_id=a.id ORDER BY id DESC LIMIT 1) an ON true WHERE a.id=ANY(${ids}) ORDER BY a.discovered_at DESC`;
    const budgets=await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
    const sources=await sql`SELECT id,health,last_ok_at,last_error FROM sources WHERE id IN ('rss-ffscout','rss-allaboutfpl')`;
    console.log(JSON.stringify({x:await xCollectionState(),budgets,sources,count:rows.length,complete:rows.filter(r=>new Date(r.analyzed_at)>new Date(snapshot.at)&&r.processing_state==='analyzed').length,states:rows.map(r=>({id:r.id,state:r.processing_state,error:r.processing_error,at:r.analyzed_at})),focus:rows.filter(r=>focus.includes(r.id))}));
  }else throw Error('Explicit mode required');
}finally{await stopBoss();await closeDb();}

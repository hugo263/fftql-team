// A bounded, source-checked editorial correction. Uses normal admin audit/projection, no model calls.
import fs from 'node:fs';
import {sql,closeDb} from '@aihot/backend/db';
import {setVisibility,overrideFields} from '@aihot/backend/admin/content';
import {stopBoss} from '@aihot/backend/jobs/queue';
const actor='editorial-v12-user-review',dir='/opt/tql-news/backups/editorial-v12-20261003',manifest=dir+'/before.json';
const excluded=[
  ['r9bnwhaiiagjlzah8m36rb7ue','国家队首发祝贺，没有俱乐部可用性或FPL信息；原文another start也不是首秀。'],
  ['lwymz2gfthrc16xcacdrew0k7','只有Team news/Watch live链接，没有可用正文、名单或视频转录，暂不发布。'],
  ['nqif17qdmnmibphpk4rdczf44','赛季球队合影宣传，不是新的注册名单或出场资格消息。'],
  ['omwni4juplowhq7qqvgal9qy9','缩写、表情和球员照片，无信息；不得猜测球员受伤。'],
  ['xmtt66z7dt5uj8kgewv8btjmb','支持口号/图片，无具体信息；不得推断争议事件。'],
  ['ndoc3fblr62b4iocaxknw7fcf','国家队比赛宣传列表，无具体伤停、负荷或俱乐部影响，不作为英超赛程变化。'],
  ['ny82flnjnnowbe45lyivboxbc','三战全胜和国旗的宣传文案，无明确英超/FPL事实；不得补成曼城晋级葡萄牙。'],
  ['mpioal4m44oygnmpmuf8qh0fj','素材描述皇马球员国家队征召/西班牙队伤停，没有明确英超或FPL关联。'],
] as const;
const corrections=[
  {id:'rfnerqmftudkmkc0btxrhtec0',fields:{category:'teams',title:'FPL 阶段复盘：伯恩茅斯前五轮表现与阵容变化',summary:'前五轮伯恩茅斯未尝胜绩，但文章认为其表现优于第17位的排名：累计xG为6.72、xGC为6.94。9名球员每轮均首发，Tyler Adams取代Lewis Cook，Ryan Christie在Justin Kluivert受伤后进入阵容；文章称Kluivert有肌肉伤势，Kroupi因脚伤预计还需缺阵约一个月，恢复时间仍是预计。',tags:['球队复盘','通用','媒体报道','伯恩茅斯']}},
  {id:'zrgqnesipains5ywbivtypg7f',fields:{category:'teams',title:'FPL 阶段复盘：阿斯顿维拉前五轮攻防与轮换趋势',summary:'维拉前五轮积4分，xG为4.62、xGC为9.21，分别排第20和第19。文章指出球队阵容逐渐稳定，Suzuki、Lindelof、Kamara、McGinn、Buendia和Jackson在GW2–5全部首发；作者预计多线作战会带来边后卫和边路轮换，Maatsen伤愈后的安排仍未确定。',tags:['球队复盘','通用','媒体报道','阿斯顿维拉']}},
  {id:'mxyn79v7q42xktein43trpf63',fields:{category:'news',title:'阿森纳门将 David 获英超九月最佳扑救奖',summary:'阿森纳官方宣布，David对阵桑德兰时的扑点获评英超九月最佳扑救。这是对已发生扑救的奖项结果，不是新的比赛得分事件，也不代表下一轮出场或选人价值发生变化。',tags:['英超快讯','通用','官方确认','阿森纳']}},
  {id:'iqafrey32dp8a24sh7t7lhnzv',fields:{category:'news',title:'Abdul Fatawu 获英超九月最佳创意瞬间奖',summary:'伊普斯维奇官方宣布，Abdul Fatawu获得英超九月Adobe Express Creative Moment of the Month奖项。此条只报道已公布的获奖结果，不据视频链接推断比赛细节或额外FPL得分。',tags:['英超快讯','通用','官方确认','伊普斯维奇']}},
  {id:'isd2frpax8xoduv8xtfl0zeqz',fields:{category:'news',title:'Lewis Miley 结束英格兰 U21 行程，返回纽卡斯尔',summary:'纽卡斯尔官方表示，Lewis Miley在随英格兰U21队活动一段时间后已返回俱乐部。推文没有说明伤病、退出原因或下轮能否出场，不能据此认定他受伤或已经伤愈。',tags:['英超快讯','通用','官方确认','纽卡斯尔']}},
  {id:'yaffu9ako69xgcb9zseguqwig',fields:{category:'players',title:'Bruno、Marcus 创造机会数位居本赛季英超前列',summary:'曼联官方表示，本赛季英超只有两名球员创造机会的次数比Bruno和Marcus更多。推文未提供具体次数；创造机会不等于实际助攻，不能据此写成助攻最多或推断后续得分。',tags:['球员与选人分析','通用','官方确认','曼联']}},
];
const ids=[...excluded.map(r=>r[0]),...corrections.map(r=>r.id)];
const rows=()=>sql`SELECT a.id,a.title,a.revision,a.body_text,p.title AS public_title,p.summary,p.category,p.tags,p.score,p.eligible,p.selected,p.visibility,o.fields,o.visibility AS override_visibility,o.reason AS override_reason,o.version AS override_version FROM articles a LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN editorial_overrides o ON o.article_id=a.id WHERE a.id=ANY(${ids}) ORDER BY a.id`;
try{
  if(process.argv.includes('--snapshot')){
    if(fs.existsSync(manifest))throw Error('Snapshot already exists; do not replace it');
    const before=await rows();if(before.length!==ids.length)throw Error('Review population changed');
    fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(manifest,JSON.stringify({at:new Date(),rows:before},null,2),{mode:0o600});
    console.log(JSON.stringify({snapshot:manifest,count:before.length}));
  }else if(process.argv.includes('--apply')){
    const snapshot=JSON.parse(fs.readFileSync(manifest,'utf8'));
    for(const current of await rows()){
      const before=snapshot.rows.find((r:{id:string})=>r.id===current.id);
      if(!before||before.revision!==current.revision||before.body_text!==current.body_text)throw Error('Source changed since review: '+current.id);
    }
    for(const id of ids){
      const [done]=await sql`SELECT 1 FROM audit_log WHERE actor=${actor} AND subject=${'content:'+id}`;
      if(done)continue;
      const before=snapshot.rows.find((r:{id:string})=>r.id===id);
      const [current]=await sql`SELECT version FROM editorial_overrides WHERE article_id=${id}`;
      const version=Number(current?.version??0);
      if(version!==Number(before.override_version??0))throw Error('Concurrent editorial correction: '+id);
      const excludedRow=excluded.find(r=>r[0]===id);
      if(excludedRow){await setVisibility(id,{visibility:'withdrawn',reason:excludedRow[1],version},actor);}
      else {const entry=corrections.find(r=>r.id===id)!;await overrideFields(id,{fields:entry.fields,reason:'按用户新发布规则核对已存原文：修正主分类和摘要，不改推荐门槛或分数。',version},actor);}
      console.log(JSON.stringify({id,action:excludedRow?'withdrawn':'corrected'}));
    }
  }else if(!process.argv.includes('--status'))throw Error('Explicit mode required');
  console.log(JSON.stringify({rows:(await rows()).map(r=>({id:r.id,title:r.public_title,category:r.category,score:r.score,eligible:r.eligible,visibility:r.visibility}))}));
}finally{await stopBoss();await closeDb();}

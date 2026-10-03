(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TQLFunModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const definitions={
  bench:{name:'板凳大亨',icon:'🪑',unit:'分',rule:'自动换人后的替补席得分；已替补上场的球员不重复计算。赛季榜累计各轮板凳分。'},
  unlucky:{name:'最惨高分',icon:'💔',unit:'分',rule:'单轮按输球经理的当轮得分排序；赛季累计所有输球轮次的得分。平局不计。'},
  narrow:{name:'险胜之王',icon:'🤏',unit:'分',rule:'单轮按获胜分差从小到大；赛季按3分以内获胜次数排名，同次数时平均胜差更小的在前。平局不计。'},
 };
 function rank(data,kind,mode,gw){
  const rounds=(data?.rounds||[]).filter(r=>mode==='season'?r.gw<=gw:r.gw===gw);
  const byId=new Map();
  const add=(id,name,detail)=>{if(!Number.isSafeInteger(id)||id<=0)return;if(!byId.has(id))byId.set(id,{entryId:id,name,details:[]});byId.get(id).details.push(detail);};
  for(const round of rounds){
   if(!round.started)continue;
   if(kind==='bench') for(const m of round.managers||[]) {
    if(Number.isFinite(m.benchPoints))add(m.entryId,m.entryName,{gw:round.gw,value:m.benchPoints,bench:m.bench,provisional:!round.settled});
   } else {
    const seen=new Set();
    for(const m of round.matches||[]){
     const key=[m.entry1Id,m.entry2Id].sort((a,b)=>a-b).join(':');
     if(seen.has(key)||!Number.isFinite(m.entry1Points)||!Number.isFinite(m.entry2Points)||m.entry1Points===m.entry2Points)continue;
     seen.add(key);
     for(const side of [1,2]){
      const other=side===1?2:1,score=m[`entry${side}Points`],against=m[`entry${other}Points`],margin=score-against;
      if(kind==='unlucky'?margin>=0:margin<=0||mode==='season'&&margin>3)continue;
      add(m[`entry${side}Id`],m[`entry${side}`],{gw:round.gw,value:kind==='unlucky'?score:margin,score,against,opponent:m[`entry${other}`]||'联赛平均分',provisional:!round.settled});
     }
    }
   }
  }
  const rows=[...byId.values()].map(row=>{
   row.value=kind==='narrow'&&mode==='season'?row.details.length:row.details.reduce((sum,d)=>sum+d.value,0);
   row.average=row.details.reduce((sum,d)=>sum+d.value,0)/row.details.length;
   row.provisional=row.details.some(d=>d.provisional);return row;
  });
  rows.sort((a,b)=>kind==='narrow'?(mode==='season'?b.value-a.value||a.average-b.average:a.value-b.value):b.value-a.value);
  rows.forEach((row,i)=>{const prev=rows[i-1];row.rank=prev&&row.value===prev.value&&(kind!=='narrow'||mode!=='season'||row.average===prev.average)?prev.rank:i+1;});
  return {rows,kind,mode,gw,provisional:rounds.some(r=>!r.settled),incomplete:!rounds.length||rounds.some(r=>!r.complete),started:rounds.some(r=>r.started)};
 }
 return {definitions,rank};
});

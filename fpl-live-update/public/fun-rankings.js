/* Fun rankings share the league snapshot; no extra browser polling. */
(function(){
 'use strict';
 const $=s=>document.querySelector(s), model=window.TQLFunModel;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let snapshot=null, mode='season', selectedGw=null, gwPinned=false, views={}, dialog=null, focus=null, oldOverflow='', detailSelection=null, shareUrl=null;
 const unit=kind=>kind==='narrow'&&mode==='season'?'次':'分';
 function note(view){return !view.started?'尚未开赛，产生得分后自动更新。':view.incomplete?'部分阵容尚待同步，当前仅展示已确认数据；累计值可能不完整。':view.provisional?'暂定榜单 · 含进行中比赛或预判自动换人，官方结算后固定。':'已结算 · 按当轮最终替补席及对阵结果统计。';}
 function subline(row,kind){return kind==='bench'?`${row.details.length} 轮板凳得分`:kind==='unlucky'?`${row.details.length} 轮输球得分`:mode==='season'?`平均胜差 ${row.average.toFixed(1)} 分`:`${row.details[0].score} – ${row.details[0].against} · ${row.details[0].opponent}`;}
 function board(kind){const view=views[kind],def=model.definitions[kind];return `<section class="fun-card" aria-labelledby="fun-${kind}-title"><header><div><span class="fun-icon" aria-hidden="true">${def.icon}</span><h3 id="fun-${kind}-title">${def.name}</h3></div><button type="button" class="fun-share" data-fun-share="${kind}" ${view.rows.length?'':'disabled'}>图片分享</button></header><p class="fun-rule">${def.rule}</p><div class="fun-table-head"><span>排名 / 经理</span><span>${kind==='narrow'?mode==='season'?'险胜次数':'获胜分差':'得分'}</span></div><div class="fun-rows">${view.rows.length?view.rows.map(row=>`<button type="button" class="fun-row" data-fun-kind="${kind}" data-fun-entry="${row.entryId}" aria-haspopup="dialog"><span class="fun-rank ${row.rank != null && row.rank <= 3 ? 'top' : ''}">${row.rank}</span><span class="fun-identity"><strong>${esc(row.name)}</strong><small>${esc(subline(row,kind))}${row.provisional?' · 暂定':''}</small></span><span class="fun-value">${row.value}<small>${unit(kind)}</small></span></button>`).join(''):`<p class="fun-empty">${!view.started?'等待比赛开始':kind==='bench'?'替补数据暂未完整同步':snapshot.meta.scoring==='c'?'积分制联赛没有直接对阵':kind==='narrow'&&mode==='season'?'还没有 3 分以内的险胜':'本轮暂没有符合条件的经理'}</p>`}</div></section>`;}
 function render(s){
  snapshot=s;
  const rounds=s.funRankings?.rounds||[];
  const max=Math.max(0,...rounds.map(r=>Number(r.gw)||0));
  if(!rounds.length){$('#funNotice').textContent='趣味榜数据正在后台收集，请稍后刷新。';$('#funBoards').innerHTML='';return;}
  if(mode==='season'||!gwPinned||!rounds.some(r=>r.gw===selectedGw))selectedGw=max;
  $('#funGw').innerHTML=`<option value="all" ${mode==='season'?'selected':''}>所有轮次</option>`+[...rounds].sort((a,b)=>b.gw-a.gw).map(r=>`<option value="${r.gw}" ${mode==='round'&&r.gw===selectedGw?'selected':''}>GW${r.gw}${r.settled?' · 已结算':r.started?' · 暂定':' · 待开赛'}</option>`).join('');
  views=Object.fromEntries(Object.keys(model.definitions).map(kind=>[kind,model.rank(s.funRankings,kind,mode,selectedGw)]));
  $('#funStatus').textContent=`${mode==='season'?'所有轮次 · 截至 ':''}GW${selectedGw}`;
  $('#funNotice').textContent=note(views.bench);
  $('#funBoards').innerHTML=Object.keys(views).map(board).join('');
 }
 function detailLines(row,kind){return row.details.flatMap(d=>kind==='bench'?[`GW${d.gw} · 板凳 ${d.value} 分${d.provisional?' · 暂定':''}`,...d.bench.map(p=>`${p.name} (${p.team||p.pos})    ${p.points} 分`)]:[`GW${d.gw} · ${row.name} ${d.score} – ${d.against} ${d.opponent}`,kind==='unlucky'?`输球得分 ${d.value} 分${d.provisional?' · 暂定':''}`:`获胜分差 ${d.value} 分${d.provisional?' · 暂定':''}`]);}
 function open(kind,id,trigger){
  const view=views[kind],row=view?.rows.find(r=>r.entryId===id);if(!row)return;
  if(!dialog){dialog=document.createElement('dialog');dialog.className='fun-dialog';dialog.setAttribute('aria-labelledby','funDetailTitle');dialog.innerHTML='<header><h2 id="funDetailTitle"></h2><div><button type="button" class="fun-share" id="funDetailShare">图片分享</button><button type="button" class="fun-close" aria-label="关闭趣味榜明细">×</button></div></header><div class="fun-detail-body"></div><p class="fun-share-status" role="status"></p>';document.body.append(dialog);
   dialog.querySelector('.fun-close').onclick=()=>dialog.close();
   dialog.addEventListener('close',()=>{document.body.style.overflow=oldOverflow;(focus?.isConnected?focus:$('#funGw'))?.focus({preventScroll:true});});
   dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
   $('#funDetailShare').onclick=e=>share(detailSelection,e.currentTarget,dialog.querySelector('.fun-share-status'));
  }
  focus=trigger;
  detailSelection={kind,mode,gw:selectedGw,row,view,leagueName:snapshot.meta.leagueName,leagueId:snapshot.meta.leagueId};
  $('#funDetailTitle').textContent=`${row.name} · ${model.definitions[kind].name}`;
  dialog.querySelector('.fun-detail-body').innerHTML=`<div class="fun-detail-total">#${row.rank} <strong>${row.value} ${unit(kind)}</strong><span>${mode==='season'?'赛季累计 · 截至 ':''}GW${selectedGw}</span></div><p class="fun-note">${esc(model.definitions[kind].rule)} ${esc(note(view))}</p>${row.details.map(d=>`<section class="fun-detail-round"><h3>GW${d.gw} <span>${d.provisional?'暂定':'已结算'}</span></h3>${kind==='bench'?`<div class="fun-bench">${d.bench.map(p=>`<div><span>${esc(p.name)} <small>${esc(p.team||p.pos)}</small></span><strong>${p.points} 分</strong></div>`).join('')}</div><p>本轮板凳合计：${d.value} 分</p>`:`<p>${esc(row.name)} <b>${d.score} – ${d.against}</b> ${esc(d.opponent)}</p><p>${kind==='unlucky'?'输球得分':'获胜分差'}：${d.value} 分</p>`}</section>`).join('')}`;
  dialog.querySelector('.fun-share-status').textContent='';oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();dialog.scrollTop=0;dialog.querySelector('.fun-close').focus({preventScroll:true});
 }
 async function share(selection,button,status){
  const {kind,mode:scope,gw,row,view,leagueName,leagueId}=selection;
  const def=model.definitions[kind],suffix=kind==='narrow'&&scope==='season'?'次':'分';
  button.disabled=true;status.textContent='正在生成图片…';
  try{
   const lines=row?detailLines(row,kind):view.rows.map(r=>`#${r.rank}  ${r.name}    ${r.value} ${suffix}${r.provisional?' · 暂定':''}`);
   const c=document.createElement('canvas'),ctx=c.getContext('2d');c.width=900;
   ctx.font='24px Arial, "PingFang SC", sans-serif';
   const wrap=text=>{const result=[];let line='';for(const ch of text){if(ctx.measureText(line+ch).width>792){result.push(line);line='';}line+=ch;}if(line)result.push(line);return result;};
   const body=[...wrap(leagueName||'Draft 联赛'),...lines.flatMap(wrap)];
   const footer=wrap(def.rule+' '+note(view));
   ctx.font='bold 28px Arial, "PingFang SC", sans-serif';
   const titleLines=wrap(`${row?row.name+' · ':''}${def.name}`);
   c.height=170+titleLines.length*38+body.length*38+footer.length*32+90;
   ctx.fillStyle='#0b1f17';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#12382a';ctx.fillRect(0,0,900,90);ctx.font='bold 30px Arial';ctx.fillStyle='#d9ef9e';ctx.fillText('TQL FPL · 联赛趣味榜',40,56);
   let y=135;ctx.font='bold 28px Arial, "PingFang SC", sans-serif';ctx.fillStyle='#edf4ee';for(const line of titleLines){ctx.fillText(line,40,y);y+=38;}
   ctx.font='20px Arial';ctx.fillStyle='#a9bcb0';ctx.fillText(`${scope==='season'?'赛季累计 · 截至 ':''}GW${gw}${row?' · #'+row.rank+' · '+row.value+' '+suffix:''}`,40,y);y+=42;
   ctx.font='24px Arial, "PingFang SC", sans-serif';ctx.fillStyle='#edf4ee';for(const line of body){ctx.fillText(line,40,y);y+=38;}
   y+=12;ctx.font='20px Arial, "PingFang SC", sans-serif';ctx.fillStyle='#a9bcb0';for(const line of footer){ctx.fillText(line,40,y);y+=32;}
   ctx.fillStyle='#12382a';ctx.fillRect(0,c.height-62,900,62);ctx.fillStyle='#d9ef9e';ctx.font='21px Arial';ctx.fillText(`fftql.team/?league=${leagueId}#fun`,40,c.height-24);
   const blobPromise=TQLNightShare.portrait(c,`https://fftql.team/?league=${leagueId}#fun`,`${def.name} · ${scope==='season'?'所有轮次':'GW'+gw}`).then(TQLNightShare.blob);
   // Start clipboard.write in the click's activation scope (including Safari).
   let copied=Promise.resolve(false);
   if(navigator.clipboard?.write&&window.ClipboardItem){try{copied=navigator.clipboard.write([new ClipboardItem({'image/png':blobPromise})]).then(()=>true,()=>false);}catch(_){/* Offer the generated file below. */}}
   const blob=await blobPromise;
   if(shareUrl)URL.revokeObjectURL(shareUrl);shareUrl=URL.createObjectURL(blob);
   status.textContent=await copied?'图片已复制，可以粘贴到微信群。 ':'浏览器未能复制图片，请预览后保存。 ';
   const a=document.createElement('a');a.href=shareUrl;a.target='_blank';a.rel='noopener';a.textContent='预览 / 保存图片';status.append(a);
  }catch(_){status.textContent='图片分享失败，请重试。';}finally{button.disabled=false;}
 }
 function summary(s,gw){
  const target=$('#weeklyFunSummary');if(!target)return;
  const view=model.rank(s.funRankings,'bench','round',gw),top=view.rows.filter(r=>r.rank===1);
  target.innerHTML=top.length?`<button type="button" id="weeklyFunOpen"><span>🪑 本轮板凳大亨${top.length>1?'（并列）':''}</span><strong>${esc(top.map(r=>r.name).join('、'))} · ${top[0].value} 分</strong><small>${view.incomplete?'数据待补全 · ':view.provisional?'暂定 · ':''}查看联赛趣味榜 →</small></button>`:'';
  $('#weeklyFunOpen')?.addEventListener('click',()=>{selectedGw=gw;gwPinned=true;mode='round';snapshot=s;document.querySelector('#tabs [data-tab="fun"]')?.click();render(s);window.scrollTo({top:0,behavior:'auto'});});
 }
 $('#funGw').addEventListener('change',e=>{const all=e.target.value==='all';mode=all?'season':'round';selectedGw=all?null:Number(e.target.value);gwPinned=!all;render(snapshot);});
 $('#funBoards').addEventListener('click',e=>{const row=e.target.closest('[data-fun-entry]');if(row)return open(row.dataset.funKind,Number(row.dataset.funEntry),row);const button=e.target.closest('[data-fun-share]');if(button){const kind=button.dataset.funShare;share({kind,mode,gw:selectedGw,view:views[kind],leagueName:snapshot.meta.leagueName,leagueId:snapshot.meta.leagueId},button,$('#funNotice'));}});
 window.TQLFun={render,summary};
})();

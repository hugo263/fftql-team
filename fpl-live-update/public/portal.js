/* Same-origin public reads. Collection and model work remain in the news worker. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), model = window.TQLNewsModel;
  let category='all', mode='all', items=[], nextCursor=null, page=1, pageCount=1, total=null;
  let requestVersion=0, controller=null, searchTimer=null, detailVersion=0, returnFocus=null;
  $('editionDate').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Shanghai'}).format(new Date());
  const element=(tag,classes,text)=>{ const node=document.createElement(tag); if(classes) node.className=classes; if(text!=null) node.textContent=text; return node; };
  const categoryBadge=item=>{const badge=element('span','story-tag news-category',model.categories[item.category] || 'FPL 资讯');if(item.category)badge.dataset.category=item.category;return badge;};
  const dateLabel=value=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(value));
  const newsUrl=id=>'https://news.fftql.team/items/'+encodeURIComponent(id);
  const external=(href,label,classes)=>{ const a=element('a',classes,label); a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; return a; };
  function articleLink(item,classes,label=item.title) {
    const a=element('a',classes,label); a.href=window.TQLEditorial?.matches(item) ? window.TQLEditorial.url : newsUrl(item.id);
    a.addEventListener('click',event=>{ if(event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {event.preventDefault(); openDetail(item,a);} });
    return a;
  }
  function meta(item,classes) {
    const row=element('div',classes); row.append(element('span','',item.source));
    const at=item.publishedAt || item.timelineAt, time=element('time','',(item.priceBatch?'观测':item.publishedAt?'发布':'收录')+' '+dateLabel(at)+'（北京）');
    time.dateTime=at; row.append(time);
    if(item.reportCount) row.append(element('span','',item.reportCount+' 篇报道'));
    return row;
  }
  function tags(item) {
    const row=element('div','news-tags');
    item.tags.filter(tag=>!Object.values(model.categories).includes(tag) && (!item.priceBatch || tag==='Classic' || tag==='官方确认' || /^GW\d+$/.test(tag))).slice(0,5).forEach(tag=>row.append(element('span','',tag)));
    return row;
  }
  function priceBulletin(batch,detailed=false) {
    const card=element('div','price-bulletin'+(detailed?' price-bulletin--detail':''));
    [true,false].forEach(up=>{
      const changes=batch.changes.filter(c=>up?c.newCost>c.oldCost:c.newCost<c.oldCost),label=up?'上涨':'下跌';
      const group=element('section','price-bulletin-group price-bulletin-group--'+(up?'up':'down'));group.setAttribute('aria-label',label+'球员');
      const heading=element('h3','price-bulletin-label',(up?'↑ ':'↓ ')+label);heading.append(element('span','',changes.length+' 人'));group.append(heading);
      if(!detailed) group.append(element('p','price-bulletin-names',changes.map(c=>c.name+'（'+c.team+'）').join('、') || '本次无'));
      else if(!changes.length) group.append(element('p','price-bulletin-empty','本次没有'+label+'球员'));
      else {
        const list=element('ul','price-bulletin-players');
        changes.forEach(c=>{
          const row=element('li'),player=element('span','price-bulletin-player');player.append(element('strong','',c.name),element('small','',c.team+' · '+c.position));
          const price=element('span','price-bulletin-price');price.append(element('span','','£'+c.oldCost.toFixed(1)+'m → '),element('strong','','£'+c.newCost.toFixed(1)+'m'));
          row.append(player,price,element('strong','price-bulletin-delta',(up?'+':'−')+'£'+Math.abs(c.newCost-c.oldCost).toFixed(1)+'m'));list.append(row);
        });group.append(list);
      }
      card.append(group);
    });
    if(detailed)card.append(element('p','price-bulletin-note','观测区间：'+dateLabel(batch.previousCheckedAt)+' — '+dateLabel(batch.observedAt)+'（北京时间）。这是两次官方数据采集之间的价格差异，不是准确调价时刻；仅适用于 Classic，不是涨跌预测。'));
    return card;
  }
  function render() {
    const fragment=document.createDocumentFragment();
    const displayItems=window.TQLEditorial ? window.TQLEditorial.order(items) : items;
    displayItems.forEach((item,index)=>{
      if(window.TQLEditorial?.matches(item)) { fragment.append(window.TQLEditorial.card(item,articleLink)); return; }
      const row=element('article','story'); row.dataset.category=item.category || '';
      row.append(element('span','story-index',String(index+1).padStart(2,'0')));
      const copy=element('div'), title=element('h3'); title.append(articleLink(item));
      copy.append(categoryBadge(item),title);
      if(item.priceBatch) copy.append(priceBulletin(item.priceBatch));
      else if(item.summary) copy.append(element('p','story-summary',item.summary));
      copy.append(tags(item),meta(item,'story-meta')); row.append(copy,articleLink(item,'story-link','↗')); fragment.append(row);
    });
    if(!items.length) { const empty=element('div','news-empty'); empty.append(element('strong','','暂无符合条件的已发布资讯'),element('span','','试试其他分类、渠道或关键词。')); fragment.append(empty); }
    $('newsList').replaceChildren(fragment);
    $('newsCount').textContent=total!=null ? total+' 条' : '已载入 '+items.length+' 条';
    $('moreNews').hidden=usePool() ? page>=pageCount : !nextCursor;
  }
  const usePool=()=>mode==='all' || !!$('newsQuery').value.trim();
  async function load(append=false) {
    const version=++requestVersion; controller?.abort(); controller=new AbortController();
    const currentController=controller,timeout=setTimeout(()=>currentController.abort(),12000);
    const pool=usePool(), params=new URLSearchParams();
    document.querySelectorAll('[data-news-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.newsMode===(pool?'all':'selected'))));
    if(category!=='all') params.set('category',category);
    if($('newsChannel').value!=='all') params.set('channel',$('newsChannel').value);
    if(pool) { params.set('page',String(append?page+1:1)); const query=$('newsQuery').value.trim(); if(query) params.set('q',query); }
    else {params.set('limit','20'); if(append && nextCursor) params.set('cursor',nextCursor);}
    $('newsList').setAttribute('aria-busy','true'); $('moreNews').disabled=true; $('newsStatus').textContent='正在同步资讯'; $('newsRetry').hidden=true;
    try {
      const response=await fetch('/api/news/'+(pool?'pool':'timeline')+'?'+params,{signal:currentController.signal});
      if(!response.ok) throw Error('News unavailable');
      const payload=await response.json(); if(version!==requestVersion) return;
      const batch=model.fromPayload(payload);
      items=append ? [...items,...batch.filter(item=>!items.some(old=>old.id===item.id))] : batch;
      nextCursor=typeof payload.nextCursor==='string' ? payload.nextCursor : null;
      page=Number.isSafeInteger(payload.page)?payload.page:1; pageCount=Number.isSafeInteger(payload.pageCount)?payload.pageCount:1;
      total=pool && Number.isSafeInteger(payload.total)?payload.total:null;
      render(); $('newsStatus').textContent=pool?'最新资讯 · 通过内容检查，按资讯时间展示':'精选推荐 · 按阅读价值筛选';
    } catch (error) {
      if(version!==requestVersion) return;
      console.warn('FPL news list unavailable:',error.message);
      $('newsStatus').textContent=items.length?'同步失败 · 保留上次内容':'资讯暂不可用'; $('newsRetry').hidden=false;
      if(!items.length) {
        const empty=element('div','news-empty'); empty.append(element('strong','','资讯暂时未能载入'),element('span','','请重试，或前往资讯站阅读。'),external('https://news.fftql.team/','打开资讯站 ↗'));
        $('newsList').replaceChildren(empty);
      }
    } finally {clearTimeout(timeout); if(version===requestVersion) { $('newsList').setAttribute('aria-busy','false'); $('moreNews').disabled=false; }}
  }
  function setCategory(value) {
    category=Object.hasOwn(model.categories,value)?value:'all';
    document.querySelectorAll('.category-tabs [data-category]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===category)));
    load();
  }
  document.querySelectorAll('.category-tabs [data-category]').forEach(button=>button.addEventListener('click',()=>setCategory(button.dataset.category)));
  document.querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>{setCategory(button.dataset.topic);$('newsTitle').scrollIntoView({block:'start'});}));
  document.querySelectorAll('[data-news-mode]').forEach(button=>button.addEventListener('click',()=>{
    mode=button.dataset.newsMode; document.querySelectorAll('[data-news-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.newsMode===mode))); load();
  }));
  $('newsQuery').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(),300);});
  $('newsChannel').addEventListener('change',()=>load()); $('newsRetry').addEventListener('click',()=>load()); $('moreNews').addEventListener('click',()=>load(true));
  const dialog=$('newsDetailDialog');
  async function openDetail(item,trigger) {
    const version=++detailVersion; returnFocus=trigger;
    dialog.classList.toggle('tql-editorial',!!window.TQLEditorial?.matches(item));
    const title=element('h2','',item.title);title.id='newsDetailTitle';
    $('newsDetailContent').replaceChildren(categoryBadge(item),title,meta(item,'story-meta'),item.priceBatch?priceBulletin(item.priceBatch,true):element('p','detail-summary',item.summary || '正在读取资讯详情…'));
    if(!dialog.open) dialog.showModal();
    try {
      const response=await fetch('/api/news/items/'+encodeURIComponent(item.id),{signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw Error('Detail unavailable');
      const detail=await response.json();if(version!==detailVersion || !dialog.open) return;
      if(window.TQLEditorial?.matches(item)) {
        const article=await window.TQLEditorial.article();
        if(version!==detailVersion || !dialog.open) return;
        $('newsDetailContent').replaceChildren(article);
        window.TQLEditorial.bind(article,()=>dialog.close());
        $('newsDetailTitle').focus({preventScroll:true});
        return;
      }
      const batch=model.normalizePriceBatch(detail.priceBatch) || item.priceBatch;
      const summary=batch?priceBulletin(batch,true):element('p','detail-summary',detail.summary || item.summary || '该条资讯暂无摘要。');
      const links=element('div','detail-links'), original=model.safeOriginal(detail.links?.original);
      if(original) links.append(external(original,'阅读原文 ↗'));
      if(detail.readingMode==='full' && detail.body) links.append(external(newsUrl(item.id),'阅读完整资讯 ↗'));
      if(item.storyId) links.append(external('https://news.fftql.team/story/'+encodeURIComponent(item.storyId),'追踪相关报道 ↗'));
      const note=element('p','detail-note',batch?'以上为该次观测的历史价格，不代表球员当前售价。':'摘要整理仅供参考，请以原文和官方公告为准。');
      $('newsDetailContent').replaceChildren(categoryBadge(item),title,meta(item,'story-meta'),tags(item),summary,links,note);
    } catch (_) {
      if(version===detailVersion && dialog.open) $('newsDetailContent').append(external(newsUrl(item.id),'前往资讯站查看 ↗'),element('p','detail-note','详情暂不可用，已保留列表摘要。'));
    }
  }
  $('newsDetailClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog && (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)) dialog.close();});
  dialog.addEventListener('close',()=>{++detailVersion;returnFocus?.focus();});
  function syncNav() {
    document.querySelectorAll('.night-global-nav a').forEach(link=>{if(link.hasAttribute('data-news-nav')) link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  }
  window.addEventListener('hashchange',syncNav);syncNav();load();
  fetch('/api/news/fpl/prices',{signal:AbortSignal.timeout(12000)}).then(async response=>{
    if(!response.ok) throw Error('Prices unavailable'); const data=await response.json();
    const checked=Date.parse(data.checkedAt);
    $('pricesStatus').textContent=Number.isFinite(checked)?data.playersTotal+' 位球员 · 同步于 '+dateLabel(data.checkedAt):'尚未建立价格基准';
    const fragment=document.createDocumentFragment();
    (Array.isArray(data.changes)?data.changes:[]).slice(0,4).forEach(change=>{
      if(!Number.isFinite(change.oldCost) || !Number.isFinite(change.newCost)) return;
      const row=element('div','price-change'),up=change.newCost>change.oldCost;
      row.append(element('span','',change.name+' · '+change.team),element('strong',up?'price-up':'price-down',(up?'↑':'↓')+' £'+change.newCost.toFixed(1)+'m'));fragment.append(row);
    });
    if(!fragment.childNodes.length) fragment.append(element('p','price-empty','暂未观测到价格变化'));
    $('priceChanges').replaceChildren(fragment);
  }).catch(()=>{$('pricesStatus').textContent='官方价格暂不可用';});
  fetch('/api/match-centre',{signal:AbortSignal.timeout(15000)}).then(async response=>{
    if(!response.ok) throw Error('Schedule unavailable');const data=await response.json(),meta=data?.meta;
    if(!Number.isInteger(meta?.gw) || meta.gw<1 || meta.gw>38) throw Error('Invalid round');
    $('portalGw').textContent='GW'+meta.gw;
    const matches=Array.isArray(data.fixtures)?data.fixtures:[],ended=match=>match.finished===true || match.finished_provisional===true;
    const live=matches.some(match=>match.started===true && !ended(match)),allFinished=matches.length>0 && matches.every(ended);
    const state=meta.stale || meta.selectionPending?'missing':live?'live':allFinished?meta.settled?'final':'pending':'upcoming';
    $('portalGwState').dataset.state=state;$('portalGwState').textContent={missing:'数据待同步',live:'比赛进行中',final:'已完赛 · 已结算',pending:'已完赛 · 待结算',upcoming:'待开赛'}[state];
    $('portalRoundNote').textContent=Number.isFinite(Date.parse(meta.updated))?'官方 FPL · 同步于 '+dateLabel(meta.updated)+'（北京）':'官方 FPL 数据 · 北京时间';
  }).catch(()=>{$('portalGwState').dataset.state='missing';$('portalGwState').textContent='赛程暂不可用';$('portalRoundNote').textContent='可继续进入 Draft 联赛';});
})();

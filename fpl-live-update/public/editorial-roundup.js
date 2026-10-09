/* The approved original is decorated only after the public news API returns it. */
(function(root){
  'use strict';
  const id='tql-international-20261008',url='/articles/fpl-international-20261008.html';
  const deadline=Date.parse('2026-10-10T10:00:00Z');
  const matches=item=>item?.id===id;
  function order(items,now=Date.now()) {
    if(now>=deadline)return items;
    return [...items.filter(matches),...items.filter(item=>!matches(item))];
  }
  const el=(tag,classes,text)=>{const n=document.createElement(tag);if(classes)n.className=classes;if(text!=null)n.textContent=text;return n;};
  function card(item,link) {
    const wrapper=el('div','tql-editorial'),row=el('article','story pinned');row.dataset.category=item.category || 'strategy';row.dataset.editorialId=id;
    row.append(el('span','story-index pin-index','✦'));
    const teaser=el('div','roundup-teaser'),copy=el('div'),kicker=el('div','roundup-kicker');
    kicker.append(el('span','roundup-badge','专题汇总'),el('span','','国际比赛日 → GW6'));copy.append(kicker);
    const title=el('h3');title.append(link(item));copy.append(title,el('p','story-summary',item.summary));
    const chips=el('div','roundup-chips');['国家队表现','伤情观察','队长与提醒','价格涨跌','截止时间'].forEach(t=>chips.append(el('span','',t)));copy.append(chips);
    const bottom=el('div','roundup-bottom'),meta=el('div','story-meta');meta.append(el('span','','TQL 编辑整理'),el('span','','10/08 · 约 7 分钟'));
    bottom.append(meta,link(item,'read-roundup','阅读完整汇总 ↗'));copy.append(bottom);
    const photo=link(item,'teaser-picture',''),img=el('img');img.src='https://resources.premierleague.pulselive.com/photo-resources/2026/10/07/c03c8525-f523-40dc-91f7-1a54d6d3bf61/FotoJet-2026-10-07T094302.387.jpg?width=1440';img.width=1440;img.height=810;img.alt='国家队比赛中的哲凯赖什、哈兰德、斯科特与梅里诺';img.referrerPolicy='no-referrer';img.decoding='async';photo.append(img,el('span','','图片：Premier League'));photo.setAttribute('aria-label','阅读国际比赛日专题汇总');teaser.append(copy,photo);row.append(teaser);wrapper.append(row);return wrapper;
  }
  let pending;
  async function article(){
    if(!pending)pending=fetch(url,{signal:AbortSignal.timeout(10000)}).then(async response=>{
      if(!response.ok)throw Error('Editorial unavailable');
      const doc=new DOMParser().parseFromString(await response.text(),'text/html');
      const content=doc.querySelector('article#international-roundup');
      if(!content || content.querySelectorAll('.article-section').length<4 || content.querySelector('script,iframe,object,embed,form'))throw Error('Unexpected editorial document');
      return content;
    }).catch(error=>{pending=null;throw error;});
    return document.importNode(await pending,true);
  }
  function bind(content,close){
    content.querySelector('[data-editorial-back]')?.addEventListener('click',event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();close();}});
    content.querySelectorAll('.article-nav a').forEach(a=>a.addEventListener('click',event=>{
      const target=content.querySelector(a.getAttribute('href'));if(target){event.preventDefault();target.scrollIntoView({block:'start'});}
    }));
  }
  const api=Object.freeze({id,url,matches,order,card,article,bind});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TQLEditorial=api;
})(typeof globalThis!=='undefined'?globalThis:this);

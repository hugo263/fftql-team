/* Published news adapter; never interprets source text as markup or instructions. */
(function (root) {
  'use strict';
  const categories = { prices:'价格变动', injuries:'伤停与复出', lineups:'首发与轮换', fixtures:'赛程变化', transfers:'转会与新援', players:'球员与选人分析', teams:'球队复盘', news:'英超快讯', strategy:'FPL 策略', rules:'规则与公告' };
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  function normalizePriceBatch(value) {
    if(!value || !Number.isSafeInteger(value.observationId) || value.observationId<1 || !time(value.observedAt) || !time(value.previousCheckedAt) || !Array.isArray(value.changes) || !value.changes.length) return null;
    const ids=new Set();
    const changes=value.changes.map(c=>{
      if(!c || !Number.isSafeInteger(c.id) || c.id<1 || ids.has(c.id) || typeof c.name!=='string' || !c.name.trim() || typeof c.team!=='string' || typeof c.position!=='string' ||
        !Number.isFinite(c.oldCost) || !Number.isFinite(c.newCost) || c.oldCost<0 || c.newCost<0 || c.oldCost>30 || c.newCost>30 || c.oldCost===c.newCost || time(c.observedAt)!==time(value.observedAt)) return null;
      ids.add(c.id);
      return {id:c.id,name:c.name.slice(0,100),team:c.team.slice(0,100),position:c.position.slice(0,40),oldCost:c.oldCost,newCost:c.newCost};
    });
    // Never silently drop invalid members and present an incomplete batch as complete.
    if(changes.some(c=>!c)) return null;
    return {observationId:value.observationId,observedAt:time(value.observedAt),previousCheckedAt:time(value.previousCheckedAt),changes};
  }
  function normalize(item, group) {
    if (!item || !validId(item.id) || typeof item.title !== 'string' || !item.title.trim()) return null;
    const timelineAt = time(item.timelineAt);
    if (!timelineAt) return null;
    return { id:item.id, title:item.title.slice(0,500), summary:typeof item.summary === 'string' ? item.summary.slice(0,3000) : '',
      source:typeof item.source?.name === 'string' ? item.source.name.slice(0,100) : '来源待同步',
      publishedAt:time(item.publishedAt), timelineAt, category:Object.hasOwn(categories,item.category) ? item.category : null,
      tags:Array.isArray(item.tags) ? item.tags.filter(tag=>typeof tag==='string').slice(0,12).map(tag=>tag.slice(0,100)) : [],
      selected:item.selected===true, channel:item.channel==='x' ? 'x' : 'news',
      priceBatch:item.category==='prices' ? normalizePriceBatch(item.priceBatch) : null,
      storyId:validId(group?.story?.publicId) ? group.story.publicId : null,
      reportCount:Number.isSafeInteger(group?.reportCount) && group.reportCount>1 ? group.reportCount : null };
  }
  function fromPayload(payload) {
    const raw = Array.isArray(payload?.cards) ? payload.cards.map(card=>normalize(card?.item,card?.group))
      : Array.isArray(payload?.items) ? payload.items.map(item=>normalize(item)) : [];
    const seen = new Set();
    return raw.filter(item=>{ if (!item || seen.has(item.id)) return false; seen.add(item.id); return true; });
  }
  function safeOriginal(value) {
    try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : null; } catch (_) { return null; }
  }
  const model = Object.freeze({ categories, validId, fromPayload, safeOriginal, normalizePriceBatch });
  if (typeof module==='object' && module.exports) module.exports=model;
  else root.TQLNewsModel=model;
})(typeof globalThis!=='undefined' ? globalThis : this);

/* Explicit placeholder gallery, independent of live score and league state. */
(() => {
  const player = '<span class="style-player"><i class="style-shirt"></i><b>—</b></span>';
  const pitch = () => `<div class="style-pitch">${FPLPitch.html()}${[1,4,4,2].map(n=>`<div class="style-pitch-row">${player.repeat(n)}</div>`).join('')}</div>`;
  const footer = '<div class="style-card-foot"><div><strong>fftql.team</strong><br><small>扫码进入网站</small></div><span class="style-qr-empty">二维码</span></div>';
  const logo = '<div class="style-card-logo"><img src="/brand/tql-badge-preview-v47.png?v=47" alt="TQL">FPL.</div>';
  const cards = [
    {name:'阵容交易名片',description:'透视球场 + 替补席，非卖品用紫色标记。',body:`${logo}<h3>你的球队 · 阵容名片</h3><small>当前持有阵容 / 位置参考最近公开阵容</small><div class="style-card-body">${pitch()}<div class="style-bench">${player.repeat(4)}</div></div>`},
    {name:'双球场对战',description:'双方首发、替补和得分同屏；赛中使用橙色。',body:`${logo}<h3>GW— · 联赛对战</h3><div class="style-card-body style-dual">${['经理 A','经理 B'].map(name=>`<div><div class="style-dual-head">${name}<b>—</b></div>${pitch()}</div>`).join('')}</div>`},
    {name:'单事件极简图',description:'只保留事件、球员得分和网站入口，不加冗余文案。',body:'<div class="style-card-body"><div class="style-event"><div><span>⚽ 球员 (球队)</span><b>—</b></div><div><span>助攻球员 (球队)</span><b>—</b></div><small>球员和分数是占位符</small></div></div>'},
    {name:'趣味排行榜',description:'适合分享榜单与经理明细，统一等宽积分。',body:`${logo}<h3>联赛趣味榜</h3><small>所有轮次 / 可选择单轮</small><div class="style-card-body">${[1,2,3,4,5].map(rank=>`<div class="style-rank"><span>${rank}</span><span>经理名称</span><b>—</b></div>`).join('')}</div>`},
  ];
  document.getElementById('styleGallery').innerHTML = cards.map(card=>`<article class="style-item"><div class="style-card">${card.body}${footer}</div><h2>${card.name}</h2><p>${card.description}</p></article>`).join('');
  window.TQLNightShare.qr('https://fftql.team/').then(image => {
    if (!image) return;
    document.querySelectorAll('.style-qr-empty').forEach(node=>{const copy=image.cloneNode();copy.className='style-qr';copy.alt='打开 fftql.team 的二维码';node.replaceWith(copy);});
  });
})();

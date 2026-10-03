/* Shared portrait/QR export primitives. Only public website URLs reach the QR service. */
(() => {
  'use strict';
  const cache = new Map();
  function qr(url) {
    let value;
    try {
      value = new URL(url);
      if (value.protocol !== 'https:' || !['fftql.team','draft.fftql.team'].includes(value.hostname)
          || value.username || value.password) return Promise.resolve(null);
    } catch (_) { return Promise.resolve(null); }
    if (cache.has(value.href)) return cache.get(value.href);
    const pending = new Promise(resolve => {
      const image = new Image(); image.crossOrigin = 'anonymous';
      let settled = false;
      const finish = loaded => {
        if (settled) return; settled = true; clearTimeout(timer);
        image.onload = image.onerror = null;
        if (!loaded) cache.delete(value.href);
        resolve(loaded);
      };
      const timer = setTimeout(() => finish(null),3500);
      image.onload = () => finish(image); image.onerror = () => finish(null);
      image.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=4&format=png&data=${encodeURIComponent(value.href)}`;
    });
    cache.set(value.href,pending);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    return pending;
  }
  function footer(ctx, image, y, width, note = '', url = 'https://fftql.team') {
    ctx.save();
    ctx.fillStyle = '#0b1f17';ctx.fillRect(0,y,width,160);
    ctx.fillStyle = '#ffffff20';ctx.fillRect(36,y,width-72,1);
    ctx.textAlign = 'left';ctx.fillStyle = '#d9ef9e';ctx.font = '700 30px system-ui, "PingFang SC", sans-serif';
    ctx.fillText('fftql.team',40,y+54);
    ctx.fillStyle = '#a9bcb0';ctx.font = '18px system-ui, "PingFang SC", sans-serif';
    if (note) {
      let text = String(note);
      while (text.length && ctx.measureText(text).width > width-250) text = text.slice(0,-1);
      ctx.fillText(text === note ? text : `${text}…`,40,y+86);
    }
    let link = String(url).replace(/^https:\/\//,'');
    ctx.font = '16px system-ui, "PingFang SC", sans-serif';
    while (link.length && ctx.measureText(link).width > width-250) link = link.slice(0,-1);
    ctx.fillText(link,40,y+114);
    ctx.fillText(image ? '扫码进入专属联赛' : '二维码暂不可用，请打开以上网址',40,y+140);
    if (image) { ctx.fillStyle = '#fff';ctx.fillRect(width-166,y+14,126,126);ctx.drawImage(image,width-161,y+19,116,116); }
    ctx.restore();
  }
  async function portrait(canvas, url, note = '') {
    const image = await qr(url);
    const result = document.createElement('canvas');result.width = 1080;result.height = 1440;
    const ctx = result.getContext('2d');
    if (!ctx) throw Error('当前浏览器无法生成分享图片');
    ctx.fillStyle = '#0b1f17';ctx.fillRect(0,0,1080,1440);
    const scale = Math.min(1008/canvas.width,1240/canvas.height);
    const width = canvas.width*scale, height = canvas.height*scale;
    ctx.drawImage(canvas,(1080-width)/2,24+(1240-height)/2,width,height);
    footer(ctx,image,1280,1080,note,url);
    return result;
  }
  function blob(canvas) {
    return new Promise((resolve,reject) => {
      try { canvas.toBlob(value => value ? resolve(value) : reject(Error('PNG 图片生成失败')),'image/png'); }
      catch (_) { reject(Error('PNG 图片无法导出，请保存页面上的备用图片')); }
    });
  }
  window.TQLNightShare = Object.freeze({qr,footer,portrait,blob});
})();

(function () {
  'use strict';

  const WIDTH = 1080;
  const PAD = 64;
  const CONTENT = WIDTH - PAD * 2;
  const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  const COLORS = {
    green: '#12382a',
    lime: '#d9ef9e',
    cream: '#f3f5f1',
    white: '#ffffff',
    muted: '#63766a',
    line: '#dce4db',
    red: '#a74635'
  };
  let ui;
  let revision = 0;
  let imageURL = '';
  let imagePromise = null;
  let imageReady = false;

  function string(value, fallback) {
    return value == null || String(value).trim() === '' ? (fallback || '') : String(value).trim();
  }

  function snapshotInput(input) {
    const value = input && typeof input === 'object' ? input : {};
    const meta = value.meta && typeof value.meta === 'object' ? value.meta : {};
    const score = value.score && typeof value.score === 'object' ? value.score : null;
    const hasOfficialState = Object.prototype.hasOwnProperty.call(meta, 'finished')
      || Object.prototype.hasOwnProperty.call(meta, 'data_checked');
    const settled = hasOfficialState
      ? meta.finished === true && meta.data_checked === true : meta.settled === true;
    // Capture values synchronously: a background refresh must not change an open card.
    return {
      url: (() => { const id=new URLSearchParams(location.search).get('league'); return `https://fftql.team/${/^\d{1,10}$/.test(id || '') && Number(id)>0 ? '?league='+Number(id) : ''}#home`; })(),
      compact: value.compact === true,
      title: string(value.title, 'FPL 比赛日'),
      subtitle: string(value.subtitle, '比赛比分 · FPL 事件速览'),
      score: score ? {
        home: string(score.home, '主队'), away: string(score.away, '客队'),
        homeScore: string(score.homeScore, '—'), awayScore: string(score.awayScore, '—'),
        minute: string(score.minute, '比赛时间待更新')
      } : null,
      events: (Array.isArray(value.events) ? value.events : []).map((event) => {
        const item = event || {};
        const time = string(item.time);
        return { tag: string(item.tag, 'FPL'), icon: string(item.icon), title: string(item.title, '比赛事件'),
          detail: string(item.detail, 'FPL 计分以官方最终确认为准'),
          points: string(item.points, '—'), time: time && time !== '—' ? time : '本场累计' };
      }),
      meta: { demo: meta.demo === true, stale: meta.stale === true,
        settled,
        updated: typeof meta.updated === 'string' ? meta.updated : '',
        gw: Number.isInteger(meta.gw) && meta.gw > 0 ? meta.gw : null }
    };
  }

  function snapshotTime(meta) {
    const prefix = meta.demo ? '示例快照时间' : '源快照时间';
    const date = new Date(meta.updated);
    if (!meta.updated || !Number.isFinite(date.getTime())) return `${prefix}：未知（北京时间）`;
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${prefix}：${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}（北京时间）`;
  }

  function font(size, weight) {
    return `${weight || 400} ${size}px ${FONT}`;
  }

  function wrap(ctx, value, maxWidth, size, weight) {
    ctx.font = font(size, weight);
    const lines = [];
    const segmenter = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;
    string(value).split(/\r?\n/).forEach((paragraph) => {
      const tokens = segmenter
        ? Array.from(segmenter.segment(paragraph), (part) => part.segment)
        : Array.from(paragraph);
      let line = '';
      tokens.forEach((token) => {
        const next = line + token;
        if (ctx.measureText(next).width <= maxWidth) {
          line = next;
          return;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = '';
        const cleanToken = token.trimStart();
        if (ctx.measureText(cleanToken).width <= maxWidth) {
          line = cleanToken;
          return;
        }
        Array.from(cleanToken).forEach((character) => {
          if (line && ctx.measureText(line + character).width > maxWidth) {
            lines.push(line);
            line = '';
          }
          line += character;
        });
      });
      lines.push(line.trimEnd());
    });
    return lines.length ? lines : [''];
  }

  function textLayout(ctx, value, width, size, weight, lineHeight) {
    const lines = wrap(ctx, value, width, size, weight);
    return { lines, size, weight: weight || 400, lineHeight: lineHeight || Math.ceil(size * 1.4),
      height: lines.length * (lineHeight || Math.ceil(size * 1.4)) };
  }

  function paintText(ctx, layout, x, y, color, align) {
    ctx.save();
    ctx.font = font(layout.size, layout.weight);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = align || 'left';
    layout.lines.forEach((line, index) => ctx.fillText(line, x, y + index * layout.lineHeight));
    ctx.restore();
  }

  function rounded(ctx, x, y, width, height, radius, color) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function containLogo(ctx, logo) {
    if (!logo || !logo.complete || !logo.naturalWidth || !logo.naturalHeight) return false;
    const box = { x: PAD, y: 54, width: 226, height: 84 };
    const ratio = Math.min(box.width / logo.naturalWidth, box.height / logo.naturalHeight);
    const width = logo.naturalWidth * ratio;
    const height = logo.naturalHeight * ratio;
    const left = box.x + (box.width - width) / 2;
    const top = box.y + (box.height - height) / 2;
    ctx.save();
    // Match the existing badge silhouette; the source image keeps its aspect ratio.
    rounded(ctx, left, top, width, height, width * 0.125, COLORS.lime);
    ctx.clip();
    ctx.drawImage(logo, left, top, width, height);
    ctx.restore();
    return true;
  }

  function paintEventIcon(ctx, kind, x, y) {
    if (typeof Path2D === 'undefined' || !['assist','red','yellow','dc','penalty_saved','penalty_missed'].includes(kind)) return false;
    ctx.save(); ctx.translate(x, y); ctx.scale(1.6, 1.6);
    ctx.strokeStyle = COLORS.lime; ctx.fillStyle = COLORS.lime;
    ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (kind === 'red' || kind === 'yellow') {
      ctx.translate(12,12); ctx.rotate((kind==='red'?12:-12)*Math.PI/180); ctx.translate(-12,-12);
      rounded(ctx,6,3,13,18,2,kind==='red'?'#ec4055':'#f5ce46');
      ctx.strokeStyle=kind==='red'?'#ffafba':'#fff1b4';ctx.stroke(new Path2D('M9 6h5'));
    } else if (kind === 'assist') {
      ctx.fill(new Path2D('M4 5 9 6 12 12 20 14Q23 15 23 19H3V13Z'));
      ctx.stroke(new Path2D('M3 20h20M6 20v2M11 20v2M17 20v2M21 20v2'));
      ctx.strokeStyle='white';ctx.stroke(new Path2D('M7 9 9 14'));
    } else if (kind === 'dc') {
      ctx.stroke(new Path2D('M4 20V7M20 20V7M2 7h4M18 7h4M8 17 12 10 16 17M8 21h8M4 13l5-2M15 11l5 2'));
      ctx.beginPath();ctx.arc(12,6,2.5,0,Math.PI*2);ctx.fill();
    } else if (kind === 'penalty_saved') {
      ctx.stroke(new Path2D('M3 12V4h18v8M7 22 5 14 7 13 10 18V9h2v6l2-5 2 1-2 6 3-3 2 2-5 6Z'));
    } else {
      ctx.stroke(new Path2D('M3 20V4h18v16M14 16l6 6M20 16l-6 6'));
      ctx.beginPath();ctx.arc(6,18,3,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();return true;
  }

  async function renderMinimalCard(input) {
    if(document.fonts?.ready)await document.fonts.ready;
    const canvas=document.createElement('canvas');canvas.width=1080;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('此浏览器无法生成分享图片。');
    const rows=input.events.map(item=>{
      const name=textLayout(ctx,item.title,690,44,700,60);
      const points=textLayout(ctx,item.points,160,52,750,66);
      return {item,name,points,height:Math.max(96,name.height+28,points.height+28)};
    });
    canvas.height=Math.max(680,80+rows.reduce((total,row)=>total+row.height,0));
    ctx.fillStyle='#0b1f17';ctx.fillRect(0,0,canvas.width,canvas.height);
    let y=(canvas.height-rows.reduce((total,row)=>total+row.height,0))/2;
    for(const row of rows) {
      rounded(ctx,32,y-4,1016,row.height-12,14,'#12382a');
      if(!paintEventIcon(ctx,row.item.icon,52,y+13))paintText(ctx,textLayout(ctx,row.item.tag,64,38,500,52),74,y+8,'#d9ef9e','center');
      paintText(ctx,row.name,126,y+8,'#edf4ee');
      paintText(ctx,row.points,1024,y+8,/^[-−]/.test(row.item.points)?'#ffb08a':'#d9ef9e','right');
      y+=row.height;
    }
    return TQLNightShare.blob(await TQLNightShare.portrait(canvas,input.url));
  }

  async function renderCard(input) {
    if(input.compact)return renderMinimalCard(input);
    if(document.fonts?.ready)await document.fonts.ready;
    const meta=input.meta;
    const state=meta.demo?'设计演示 · 非实时数据':meta.stale?'数据延迟':meta.settled?'FPL 已结算':'FPL 暂定 · 可修订';
    const canvas=document.createElement('canvas');canvas.width=WIDTH;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('此浏览器无法生成分享图片。');
    const title=textLayout(ctx,input.title,CONTENT,42,750,58);
    const subtitle=textLayout(ctx,input.subtitle,CONTENT,22,400,32);
    const events=input.events.slice(0,5).map(item=>{
      const title=textLayout(ctx,item.title,600,29,700,40),detail=textLayout(ctx,item.detail,600,21,400,30);
      const time=textLayout(ctx,item.time,90,17,500,25),points=textLayout(ctx,item.points,135,36,750,48);
      return {item,title,detail,time,points,height:Math.max(112,title.height+detail.height+42,time.height+56)};
    });
    let y=170+title.height+subtitle.height+24,score=null;
    if(input.score) {
      const s=input.score,home=textLayout(ctx,s.home,290,28,650,38),away=textLayout(ctx,s.away,290,28,650,38);
      const result=textLayout(ctx,s.homeScore+' – '+s.awayScore,250,64,750,82),minute=textLayout(ctx,s.minute,CONTENT,20,500,30);
      const mainHeight=Math.max(home.height,away.height,result.height);
      score={home,away,result,minute,y,mainHeight,height:mainHeight+minute.height+48};y+=score.height+20;
    }
    const eventHeadingY=y;y+=52;events.forEach(event=>{event.y=y;y+=event.height+12;});if(!events.length)y+=96;
    const selection=textLayout(ctx,input.events.length>5?'展示当前筛选的前 5 条 · 共 '+input.events.length+' 条':'当前筛选 · 共 '+input.events.length+' 条',CONTENT,18,400,28);
    const timestamp=textLayout(ctx,snapshotTime(meta),CONTENT,19,400,28);
    const warning=textLayout(ctx,meta.demo?'演示数据，不代表真实比赛。':meta.stale?'上次成功快照，可能滞后；以官方最终计分为准。':meta.settled?'本轮已结算，事件按源快照展示。':'比分与 FPL 计分可能修订，最终以官方结算为准。',CONTENT,19,400,28);
    canvas.height=y+selection.height+timestamp.height+warning.height+70;
    ctx.fillStyle='#0b1f17';ctx.fillRect(0,0,WIDTH,canvas.height);
    if(!containLogo(ctx,document.getElementById('brandLogo')))paintText(ctx,textLayout(ctx,'TQL · FPL',280,36,750,48),PAD,66,'#d9ef9e');
    rounded(ctx,WIDTH-PAD-330,66,330,50,12,meta.stale?'#fbf2dc':'#ffffff0d');
    paintText(ctx,textLayout(ctx,state,308,22,650,30),WIDTH-PAD-165,76,meta.stale?'#9a6a00':'#a9bcb0','center');
    paintText(ctx,title,PAD,170,'#edf4ee');paintText(ctx,subtitle,PAD,170+title.height+6,'#a9bcb0');
    if(score) {
      const s=score;rounded(ctx,PAD,s.y,CONTENT,s.height,14,'#12382a');const cy=s.y+16+s.mainHeight/2;
      paintText(ctx,s.home,PAD+160,cy-s.home.height/2,'#edf4ee','center');
      paintText(ctx,s.result,WIDTH/2,cy-s.result.height/2,'#d9ef9e','center');
      paintText(ctx,s.away,WIDTH-PAD-160,cy-s.away.height/2,'#edf4ee','center');
      paintText(ctx,s.minute,WIDTH/2,s.y+20+s.mainHeight,'#a9bcb0','center');
    }
    paintText(ctx,textLayout(ctx,(meta.gw?'GW'+meta.gw+' · ':'')+'比赛进展',CONTENT,25,650,36),PAD,eventHeadingY,'#d9ef9e');
    events.forEach(event=>{
      rounded(ctx,PAD,event.y,CONTENT,event.height,12,'#12382a');
      if(!paintEventIcon(ctx,event.item.icon,PAD+25,event.y+16))paintText(ctx,textLayout(ctx,event.item.tag,68,27,650,36),PAD+46,event.y+16,'#d9ef9e','center');
      paintText(ctx,event.time,PAD+46,event.y+60,'#a9bcb0','center');
      paintText(ctx,event.title,PAD+110,event.y+16,'#edf4ee');
      paintText(ctx,event.detail,PAD+110,event.y+22+event.title.height,'#a9bcb0');
      paintText(ctx,event.points,WIDTH-PAD-78,event.y+16,/^[-−]/.test(event.item.points)?'#ffb08a':'#d9ef9e','center');
    });
    if(!events.length)paintText(ctx,textLayout(ctx,'当前筛选下暂无事件',CONTENT,26,500,38),PAD,eventHeadingY+62,'#a9bcb0');
    let footer=y+12;paintText(ctx,selection,PAD,footer,'#a9bcb0');footer+=selection.height+8;
    paintText(ctx,timestamp,PAD,footer,'#a9bcb0');footer+=timestamp.height+8;paintText(ctx,warning,PAD,footer,'#a9bcb0');
    return TQLNightShare.blob(await TQLNightShare.portrait(canvas,input.url,state));
  }

  function releaseImage() {
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = '';
    imagePromise = null;
    imageReady = false;
    if (ui) {
      ui.preview.removeAttribute('src');
      ui.preview.hidden = true;
      ui.download.removeAttribute('href');
      ui.download.setAttribute('aria-disabled', 'true');
      ui.copy.disabled = true;
    }
  }

  function copyImage() {
    if (!imageReady || !imagePromise) return;
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof window.ClipboardItem !== 'function') {
      ui.status.textContent = '当前浏览器不支持复制图片，请使用“下载 PNG”。';
      return;
    }
    const currentRevision = revision;
    ui.copy.disabled = true;
    ui.status.textContent = '正在复制图片…';
    let copyRequest;
    try {
      // Call write synchronously during the click; the PNG itself is a Promise.
      copyRequest = navigator.clipboard.write([new ClipboardItem({ 'image/png': imagePromise })]);
    } catch (_) {
      ui.copy.disabled = false;
      ui.status.textContent = '未能复制图片，请使用“下载 PNG”。';
      return;
    }
    Promise.resolve(copyRequest).then(() => {
      if (currentRevision === revision) ui.status.textContent = '图片已复制，可粘贴到聊天窗口。';
    }).catch(() => {
      if (currentRevision === revision) ui.status.textContent = '未能复制图片，请使用“下载 PNG”。';
    }).finally(() => {
      if (currentRevision === revision) ui.copy.disabled = !imageReady;
    });
  }

  function initialize(root = document) {
    if (ui) return;
    const elements = {
      dialog: root.getElementById('shareDialog'),
      preview: root.getElementById('sharePreview'),
      copy: root.getElementById('copyImage'),
      download: root.getElementById('downloadImage'),
      status: root.getElementById('shareStatus'),
      close: root.getElementById('closeShare')
    };
    if (Object.values(elements).some((element) => !element)) throw new Error('分享预览缺少必要的页面元素。');
    if (typeof elements.dialog.showModal !== 'function') throw new Error('此浏览器不支持分享预览对话框。');
    ui = elements;
    ui.copy.addEventListener('click', copyImage);
    ui.close.addEventListener('click', () => ui.dialog.close());
    ui.dialog.addEventListener('close', () => {
      revision += 1;
      releaseImage();
    });
    ui.download.addEventListener('click', (event) => {
      if (!imageReady || !imageURL) event.preventDefault();
    });
    ui.status.setAttribute('role', 'status');
    ui.status.setAttribute('aria-live', 'polite');
  }

  async function open(input, root = document) {
    initialize(root);
    const snapshot = snapshotInput(input);
    const currentRevision = ++revision;
    releaseImage();
    ui.status.textContent = snapshot.meta.demo ? '正在生成演示分享卡…' : '正在生成分享卡…';
    if (!ui.dialog.open) ui.dialog.showModal();
    imagePromise = renderCard(snapshot);
    try {
      const blob = await imagePromise;
      if (currentRevision !== revision) return false;
      imageURL = URL.createObjectURL(blob);
      ui.preview.src = imageURL;
      ui.preview.alt = snapshot.compact ? '球员事件与得分，https://fftql.team' : `FPL 比赛日分享卡，${snapshot.meta.demo ? '设计演示，非实时数据'
        : `${snapshot.meta.stale ? '数据延迟，' : ''}${snapshot.meta.settled ? 'FPL 已结算' : 'FPL 暂定，以官方结算为准'}`}`;
      ui.preview.hidden = false;
      ui.download.href = imageURL;
      ui.download.download = `tql-fpl-matchday${snapshot.meta.gw ? `-gw${snapshot.meta.gw}` : ''}${snapshot.meta.demo ? '-demo' : ''}.png`;
      ui.download.removeAttribute('aria-disabled');
      imageReady = true;
      ui.copy.disabled = false;
      ui.status.textContent = `${snapshot.meta.demo ? '演示分享卡' : '分享卡'}已准备好，可复制图片或下载 PNG。`;
      return true;
    } catch (error) {
      if (currentRevision === revision) {
        ui.status.textContent = string(error && error.message, '分享图片生成失败，请重试。');
        ui.copy.disabled = true;
      }
      return false;
    }
  }

  window.TQLShare = Object.freeze({ open });
})();

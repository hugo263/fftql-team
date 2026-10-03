/* Match report PNG export. No DOM UI, navigation, upload or external image service. */
(function (root) {
  'use strict';

  const WIDTH = 1080;
  const SIDE_WIDTH = 1016;
  const SIDE_X = 32;
  const SIDE_TOP = 116;
  const SIDE_HEADER_HEIGHT = 66;
  const SIDE_GAP = 16;
  const ROW_HEIGHT = 92;
  const KIT_TIMEOUT_MS = 5000;
  const BRAND_URL = '/brand/tql-badge-preview-v47.png?v=47';
  const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  const COLORS = {
    forest: '#12382a', deep: '#0b1f17', lime: '#d9ef9e', white: '#edf4ee',
    canvas: '#f3f5f1', ink: '#14201a', muted: '#607166', line: '#dce5d7',
    red: '#ffc1a5', live: '#e4572e',
  };
  const STATUS_LABEL = {
    played: '已出战', playing: '赛中', pending: '待开赛', waiting: '待出场',
    dnp: '未出场', blank: '无赛程', unknown: '暂无数据',
  };
  const TEAM_COLORS = {
    ARS: ['#d92030', '#ffffff'], AVL: ['#771e3a', '#94d1ef'], BOU: ['#ce2839', '#171e1b'],
    BRE: ['#dc2535', '#ffffff'], BHA: ['#286abb', '#ffffff'], BUR: ['#772338', '#91cde5'],
    CHE: ['#1553b2', '#ffffff'], COV: ['#6eb9e1', '#ffffff'], CRY: ['#2348a4', '#e33142'],
    EVE: ['#1e56af', '#ffffff'], FUL: ['#ffffff', '#292929'], IPS: ['#2364b7', '#ffffff'],
    LEE: ['#ffffff', '#e8bc29'], LEI: ['#2161bd', '#e6c041'], LIV: ['#ce2535', '#ffffff'],
    MCI: ['#7ebbdc', '#ffffff'], MUN: ['#d83032', '#ffffff'], NEW: ['#222222', '#ffffff'],
    NFO: ['#e33434', '#ffffff'], SOU: ['#e93439', '#ffffff'], SUN: ['#df2539', '#ffffff'],
    TOT: ['#ffffff', '#142e4d'], WHU: ['#782341', '#76bee1'], WOL: ['#e7a622', '#202622'],
  };
  const kitCache = new Map();

  function number(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function valueText(value) {
    return number(value) == null ? '—' : String(number(value));
  }

  function playerScore(player) {
    // An unused bench player can still receive a card deduction. Conversely,
    // a pending second DGW fixture must not hide points from the first match.
    if (player.status === 'unknown') return '—';
    const points = number(player.points);
    const hasPoints = number(player.minutes) > 0 || number(player.yellowCards) > 0
      || number(player.redCards) > 0 || points < 0;
    return hasPoints ? valueText(points) : '—';
  }

  function substitutionFor(side, player) {
    const substitutions = Array.isArray(side.substitutions) ? side.substitutions : [];
    const involved = substitutions.filter(sub => ['official', 'projected'].includes(sub.source)
      && [number(sub.element_in), number(sub.element_out)].includes(number(player.id)));
    const substitution = involved.find(sub => sub.source === 'official') || involved[0];
    if (!substitution) return null;
    const incoming = number(substitution.element_in) === number(player.id);
    return {
      source: substitution.source, incoming,
      pending: substitution.source === 'projected' && substitution.pending === true,
      badge: `${substitution.source === 'projected' ? '预' : '替'}${incoming ? '↑' : '↓'}`,
    };
  }

  function substitutionSummary(side) {
    const substitutions = Array.isArray(side.substitutions) ? side.substitutions : [];
    const official = substitutions.filter(sub => sub.source === 'official').length;
    const projected = substitutions.filter(sub => sub.source === 'projected').length;
    const pending = substitutions.filter(sub => sub.source === 'projected' && sub.pending === true).length;
    return [official ? `官方替补 ${official} 组` : '',
      projected ? `预判 ${projected} 组${pending ? ` / ${pending} 人待上场` : ''}` : side.provisional ? '含替补预判' : ''].filter(Boolean).join(' · ');
  }

  function text(value, fallback = '—') {
    return value == null || String(value).trim() === '' ? fallback : String(value);
  }

  function kitPath(player) {
    const code = number(player.teamCode);
    return Number.isInteger(code) && code > 0 && code < 1000000
      ? `/api/kit/${code}${player.pos === 'GKP' ? '-gk' : ''}.png` : '';
  }

  function loadKit(player) {
    return loadImage(kitPath(player));
  }

  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    const ready = url === BRAND_URL && Array.from(root.document.images || []).find(image =>
      image.getAttribute('src') === url && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    if (ready) return Promise.resolve(ready);
    if (kitCache.has(url)) return kitCache.get(url);
    const promise = new Promise((resolve) => {
      const image = new root.Image();
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        image.onload = image.onerror = null;
        if (!loaded) kitCache.delete(url);
        resolve(loaded);
      };
      const timer = root.setTimeout(() => finish(null), KIT_TIMEOUT_MS);
      image.crossOrigin = 'anonymous';
      image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
      image.onerror = () => finish(null);
      image.src = url;
    });
    kitCache.set(url, promise);
    return promise;
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

  function fit(ctx, value, width) {
    const chars = Array.from(text(value));
    if (ctx.measureText(chars.join('')).width <= width) return chars.join('');
    while (chars.length && ctx.measureText(`${chars.join('')}…`).width > width) chars.pop();
    return `${chars.join('')}…`;
  }

  function label(ctx, value, x, y, size, color, weight = 500, width = Infinity, align = 'left') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(fit(ctx, value, width), x, y);
  }

  function drawWordmark(ctx, image) {
    const x = 32, y = 16, width = 204, height = 76;
    if (image) {
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const imageWidth = image.naturalWidth * scale;
      const imageHeight = image.naturalHeight * scale;
      const left = x + (width - imageWidth) / 2, top = y + (height - imageHeight) / 2;
      ctx.save();
      // Same rounded badge silhouette as the workbench header.
      rounded(ctx, left, top, imageWidth, imageHeight, imageWidth * .125, COLORS.lime);
      ctx.clip();
      ctx.drawImage(image, left, top, imageWidth, imageHeight);
      ctx.restore();
    } else {
      rounded(ctx, x, y, width, height, 12, COLORS.lime);
      label(ctx, 'TQL FPL', x + width / 2, y + height / 2 + 11, 31, COLORS.forest, 900, width - 16, 'center');
    }
  }

  function snapshotTime(updated) {
    const date = new Date(updated);
    if (!updated || !Number.isFinite(date.getTime())) return '快照时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date) + '（北京时间）';
  }

  function splitSide(side) {
    const substitutions = (Array.isArray(side.substitutions) ? side.substitutions : []).map(sub => ({ ...sub }));
    const players = (Array.isArray(side.players) ? side.players : [])
      .map((player) => ({ ...player, matchSubstitution: substitutionFor(side, player), fixtures: Array.isArray(player.fixtures)
        ? player.fixtures.map((fixture) => ({ ...fixture })) : [] }))
      .sort((a, b) => (number(a.position) ?? 99) - (number(b.position) ?? 99));
    const counts = (player) => typeof player.countsForTeam === 'boolean'
      ? player.countsForTeam : number(player.position) != null && number(player.position) <= 11;
    const starters = players.filter(counts);
    const bench = players.filter((player) => !counts(player));
    const groups = { GKP: [], DEF: [], MID: [], FWD: [], UNKNOWN: [] };
    starters.forEach((player) => (groups[player.pos] || groups.UNKNOWN).push(player));
    return { ...side, substitutions, players, starters, bench, groups };
  }

  function polygon(ctx, points, fill, stroke = null) {
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawPitch(ctx, x, y, width, height) {
    root.FPLPitch.draw(ctx, x, y, width, height);
  }

  function drawFallbackKit(ctx, player, x, y) {
    const colors = player.pos === 'GKP' ? ['#eac34f', '#26352d']
      : TEAM_COLORS[player.team] || ['#d9ef9e', '#12382a'];
    ctx.save();
    ctx.translate(x, y);
    polygon(ctx, [[-16, -26], [-35, -15], [-27, 3], [-19, 0], [-18, 30], [18, 30], [19, 0], [27, 3], [35, -15], [16, -26]], colors[0], 'rgba(255,255,255,.65)');
    ctx.strokeStyle = colors[1];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-12, -24);
    ctx.quadraticCurveTo(0, -10, 12, -24);
    ctx.stroke();
    label(ctx, text(player.team, 'FPL'), 0, 13, 10, colors[1], 800, 31, 'center');
    ctx.restore();
  }

  function drawPlayer(ctx, player, center, top, width, images, bench = false) {
    const image = images.get(kitPath(player));
    const shirtHeight = player.pos === 'GKP' ? 35 : 40;
    if (image) {
      const imageWidth = Math.min(width - 18, shirtHeight * image.naturalWidth / image.naturalHeight);
      const imageHeight = imageWidth * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, center - imageWidth / 2, top + shirtHeight - imageHeight, imageWidth, imageHeight);
    } else {
      ctx.save();ctx.translate(center,top + 19);ctx.scale(.68,.68);
      drawFallbackKit(ctx, player, 0, 0);ctx.restore();
    }
    const substitution = player.matchSubstitution;
    if (substitution) {
      const badgeX = center + Math.min(30, width / 2 - 50);
      rounded(ctx, badgeX, top + 4, 48, 23, 4,
        substitution.source === 'projected' ? '#ffe8ad' : COLORS.lime);
      label(ctx, substitution.badge, badgeX + 24, top + 21, 16,
        substitution.source === 'projected' ? '#755017' : COLORS.forest, 800, 43, 'center');
    }
    const plateX = center - width / 2;
    rounded(ctx, plateX, top + 36, width, 42, 7, '#f3f5f1');
    label(ctx, player.name, center, top + 54, 19, '#14201a', 750, width - 10, 'center');
    const playing = player.status === 'playing';
    const scoreText = playerScore(player);
    ctx.fillStyle = playing ? COLORS.live : scoreText !== '—' ? COLORS.lime : '#e4eadd';
    ctx.fillRect(plateX, top + 58, width, 20);
    const pts = number(player.points);
    label(ctx, playing ? `${scoreText} · 赛中` : scoreText === '—' ? '—' : `${scoreText} 分`,
      center, top + 74, 18, playing ? COLORS.white : pts != null && pts < 0 ? '#b3402a' : COLORS.forest, 800, width - 8, 'center');
    const minutes = number(player.minutes);
    const completed = player.status === 'played' && player.fixtures.length > 0
      && player.fixtures.every((fixture) => fixture.finished === true);
    const status = completed ? '已完赛' : STATUS_LABEL[player.status] || STATUS_LABEL.unknown;
    const detail = substitution?.incoming && substitution.pending && !(minutes > 0)
      ? '预判替补 · 待上场'
      : playing ? `${minutes == null ? '—′' : `${minutes}′`} · 球队比赛中`
      : minutes > 0 ? `${minutes}′ · ${status}` : status;
    label(ctx, detail, center, top + 91, 13, playing ? '#b64122' : '#496344', 500, width, 'center');
  }

  function drawSide(ctx, side, sideIndex, images, rows, pitchHeight, benchHeight, sideHeight) {
    const x = SIDE_X;
    const top = SIDE_TOP + sideIndex * (sideHeight + SIDE_GAP);
    const pitchTop = top + SIDE_HEADER_HEIGHT + 10;
    rounded(ctx, x, top, SIDE_WIDTH, SIDE_HEADER_HEIGHT, 10, '#ffffff');
    label(ctx, side.entryName, x + 18, top + 28, 25, COLORS.ink, 800, SIDE_WIDTH - 175);
    const formation = text(side.formation, ['DEF', 'MID', 'FWD'].map((pos) => side.groups[pos].length).join('-'));
    const stats = side.preview ? `${text(side.playerName, 'Draft 玩家')} · 当前阵容 · 非该轮锁定 · ${formation}`
      : `${text(side.playerName, 'Draft 玩家')} · 出战 ${valueText(side.playedCount)}/${valueText(side.startingCount)} · 余程 ${valueText(side.remainingCount)} · ${formation}`;
    label(ctx, stats, x + 19, top + 53, 16, COLORS.muted, 500, SIDE_WIDTH - 175);
    const score = number(side.score);
    rounded(ctx, x + SIDE_WIDTH - 134, top + 9, 116, 48, 8, '#e5efda');
    label(ctx, valueText(score), x + SIDE_WIDTH - 76, top + 44, 36, score != null && score < 0 ? '#b3402a' : COLORS.forest, 850, 102, 'center');

    rounded(ctx, x, pitchTop - 4, SIDE_WIDTH, pitchHeight + 8, 9, '#f3f6ef');
    drawPitch(ctx, x + 15, pitchTop, SIDE_WIDTH - 30, pitchHeight);
    if (!side.starters.length) {
      label(ctx, '本轮阵容数据暂未提供', x + SIDE_WIDTH / 2, pitchTop + pitchHeight / 2, 23, COLORS.ink, 600, SIDE_WIDTH - 90, 'center');
    }
    rows.forEach((pos, rowIndex) => {
      const players = side.groups[pos];
      if (!players.length) return;
      const playerTop = pitchTop + 4 + rowIndex * ROW_HEIGHT;
      const bounds = root.FPLPitch.boundsAt((playerTop + 58 - pitchTop) / pitchHeight);
      const rowWidth = (SIDE_WIDTH - 30) * (bounds.right - bounds.left) - 20;
      const cardWidth = Math.min(172, (rowWidth - Math.max(0, players.length - 1) * 10) / players.length);
      const step = Math.min(205, (rowWidth + 10) / players.length);
      players.forEach((player, index) => drawPlayer(ctx, player,
        x + SIDE_WIDTH / 2 + (index - (players.length - 1) / 2) * step,
        playerTop, cardWidth, images));
    });

    const benchTop = pitchTop + pitchHeight + 10;
    rounded(ctx, x, benchTop, SIDE_WIDTH, benchHeight, 12, '#eaf0e3');
    label(ctx, '替补 · 不计总分', x + 18, benchTop + 24, 18, COLORS.ink, 750, 390);
    const substitutions = substitutionSummary(side);
    if (substitutions) label(ctx, substitutions, x + SIDE_WIDTH / 2, benchTop + 24, 17,
      side.provisional ? '#8c641b' : COLORS.muted, 600, 485, 'center');
    label(ctx, `${valueText(side.benchPoints)} 分`, x + SIDE_WIDTH - 18, benchTop + 24, 18, COLORS.muted, 600, 270, 'right');
    if (!side.bench.length) label(ctx, '暂无替补数据', x + SIDE_WIDTH / 2, benchTop + 110, 18, COLORS.muted, 500, 500, 'center');
    side.bench.forEach((player, index) => {
      const row = Math.floor(index / 4);
      const inRow = Math.min(4, side.bench.length - row * 4);
      const center = x + SIDE_WIDTH / 2 + (index % 4 - (inRow - 1) / 2) * 222;
      drawPlayer(ctx, player, center, benchTop + 29 + row * ROW_HEIGHT, 172, images, true);
    });
  }

  async function createBlob(detail) {
    if (!detail || !Array.isArray(detail.sides) || detail.sides.length !== 2) {
      throw new Error('分享图片需要双方的本轮阵容数据。');
    }
    // Capture values now: later polling may replace the caller's live detail.
    const snapshot = { ...detail, sides: detail.sides.map(splitSide) };
    const hasProjected = snapshot.sides.some(side => side.provisional
      || side.substitutions.some(sub => sub.source === 'projected'));
    const rows = ['GKP', 'DEF', 'MID', 'FWD'];
    if (snapshot.sides.some((side) => side.groups.UNKNOWN.length)) rows.push('UNKNOWN');
    const pitchHeight = rows.length * ROW_HEIGHT + 12;
    const benchRows = Math.max(1, ...snapshot.sides.map((side) => Math.ceil(side.bench.length / 4)));
    const benchHeight = 126 + (benchRows - 1) * ROW_HEIGHT;
    const sideHeight = SIDE_HEADER_HEIGHT + 10 + pitchHeight + 10 + benchHeight;
    const footerTop = SIDE_TOP + snapshot.sides.length * sideHeight + SIDE_GAP + 18;
    const height = footerTop;
    const images = new Map();
    const [wordmark] = await Promise.all([
      loadImage(BRAND_URL).catch(() => null),
      Promise.all(snapshot.sides.flatMap((side) => side.players).map(async (player) => {
        const image = await loadKit(player);
        if (image) images.set(kitPath(player), image);
      })),
    ]);
    const canvas = root.document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持生成分享图片。');
    ctx.fillStyle = COLORS.canvas;
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.fillStyle = COLORS.forest;
    ctx.fillRect(0, 0, WIDTH, 108);
    drawWordmark(ctx, wordmark);
    label(ctx, `GW${valueText(snapshot.gw)} · ${text(snapshot.leagueName, 'Draft 联赛')}`,
      254, 43, 29, COLORS.white, 800, 590);
    label(ctx, `快照 ${snapshotTime(snapshot.updated)}`, 254, 80, 21, '#c5d9cb', 500, 590);
    const phase = snapshot.preview ? '赛前阵容预览' : snapshot.stale ? '数据有延迟' : snapshot.live ? '进行中快照' : snapshot.finished ? '完赛快照' : '赛前快照';
    rounded(ctx, 869, 27, 179, 43, 7, snapshot.stale ? '#f2dcb6' : COLORS.lime);
    label(ctx, phase, 958.5, 56, 22, COLORS.forest, 800, 162, 'center');

    snapshot.sides.forEach((side, index) => drawSide(ctx, side, index, images, rows, pitchHeight, benchHeight, sideHeight));
    const leagueId = /^\d{1,10}$/.test(String(snapshot.leagueId || '')) ? snapshot.leagueId : null;
    const url = `https://fftql.team/${leagueId ? `?league=${leagueId}` : ''}#weekly`;
    const note = snapshot.preview ? '赛前预览 · 非该轮锁定阵容；截止前可调整'
      : hasProjected ? '含预判自动替补，最终以官方结算为准' : '仅有效首发计总分 · 含防守贡献/奖励分 · Draft 无队长';
    // Preserve every XI/bench player, even for an unusual extra position row.
    const portrait = await root.TQLNightShare.portrait(canvas,url,note);
    return root.TQLNightShare.blob(portrait);
  }

  root.FPLMatchShare = Object.freeze({ createBlob });
})(typeof window !== 'undefined' ? window : globalThis);

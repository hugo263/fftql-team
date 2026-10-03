(function () {
  'use strict';
  function mount(root = document) {
  const $ = id => root.getElementById(id);
  let active = true;
  const renderer = window.TQLLiveRender;
  const patch = (id, html) => {
    const target = $(id);
    if (renderer) return renderer.patch(target, html);
    if (target.innerHTML === html) return false;
    target.innerHTML = html; return true;
  };
  const eventKey = event => renderer?.eventKey(event) || `event:${event.id}`;
  let seenEvents = new Set(), pendingEvents = new Set(), feedScope = '', holdFeed = false;
  let requestSequence = 0, requestAbort = null, requestGw = null, inFlight = null;
  let manualRefreshSequence = 0;
  let refreshStatusPending = false;
  let streamState = '', transportFailed = false;
  let fallbackTimer = null, failures = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const signed = number => number != null && Number.isFinite(Number(number)) ? `${Number(number) > 0 ? '+' : Number(number) < 0 ? '−' : ''}${Math.abs(Number(number))}` : '待同步';
  const shortDate = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(new Date(value)) : '待定';
  const clockTime = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)) : '时间未知';
  const dayKey = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : 'tbd';
  const chineseTeams = {ARS:'阿森纳',AVL:'阿斯顿维拉',BOU:'伯恩茅斯',BRE:'布伦特福德',BHA:'布莱顿',BUR:'伯恩利',CHE:'切尔西',COV:'考文垂',CRY:'水晶宫',EVE:'埃弗顿',FUL:'富勒姆',HUL:'赫尔城',IPS:'伊普斯维奇',LEE:'利兹联',LEI:'莱斯特城',LIV:'利物浦',MCI:'曼城',MUN:'曼联',NEW:'纽卡斯尔',NFO:'诺丁汉森林',SOU:'南安普顿',SUN:'桑德兰',TOT:'热刺',WHU:'西汉姆联',WOL:'狼队'};
  const clubColors = {ARS:'#bb2438',AVL:'#79364c',BOU:'#a6202c',BRE:'#bd2e36',BHA:'#2871af',CHE:'#275da7',CRY:'#4163a5',EVE:'#326399',FUL:'#263c36',IPS:'#396cb0',LEE:'#b79c34',LIV:'#b92938',MCI:'#67a6bd',MUN:'#b62b37',NEW:'#39423f',NFO:'#b43831',SUN:'#bd3b3c',TOT:'#344760',WHU:'#863d57',WOL:'#bd8b30'};
  const types = {goal:{tag:'⚽',label:'进球',cls:'goal',group:'ga'},ga:{tag:'⚽',label:'进球／助攻',cls:'goal',group:'ga'},assist:{tag:'助攻',label:'FPL 助攻',cls:'assist',group:'ga'},yellow:{tag:'黄牌',label:'黄牌',cls:'card',group:'cards'},red:{tag:'红牌',label:'红牌',cls:'red',group:'cards'},cs:{tag:'🧤',label:'零封得分',cls:'cs',group:'cs'},cs_lost:{tag:'🥅',label:'零封失去',cls:'lost',group:'cs'},dc:{tag:'DC',label:'防守贡献',cls:'dc',group:'other'},bonus:{tag:'⭐',label:'Bonus 奖励分',cls:'bonus',group:'other'},penalty_saved:{tag:'扑点',label:'扑出点球',cls:'penalty-save',group:'other'},penalty_missed:{tag:'失点',label:'罚丢点球',cls:'penalty-miss',group:'other'}};
  // Compact match-centre pictograms, drawn locally rather than hotlinking third-party assets.
  const eventSymbols = {
    assist:'<path d="m4 5 5 1 3 6 8 2q3 1 3 5H3v-6z" fill="currentColor" stroke="none"/><path d="m10 9 3-1m-2 4 3-1M3 20h20m-17 0v2m5-2v2m6-2v2m4-2v2"/><path d="m6 8 2 6" stroke="white"/>',
    red:'<rect x="6" y="3" width="13" height="18" rx="2" transform="rotate(12 12 12)" fill="#ec4055" stroke="#bf233d"/><path d="m9 6 5 1" stroke="#ffafba" stroke-width="1.2"/>',
    yellow:'<rect x="6" y="3" width="13" height="18" rx="2" transform="rotate(-12 12 12)" fill="#f5ce46" stroke="#bf921c"/><path d="m9 7 5-1" stroke="#fff1b4" stroke-width="1.2"/>',
    dc:'<path d="M4 20V7m16 13V7M2 7h4m12 0h4M8 17l4-7 4 7M8 21h8"/><circle cx="12" cy="6" r="2.5" fill="currentColor" stroke="none"/><path d="m4 13 5-2m6 0 5 2"/>',
    penalty_saved:'<path d="M3 12V4h18v8M7 4v6m5-6v4m5-4v5M3 8h18M7 22l-2-8 2-1 3 5V9h2v6l2-5 2 1-2 6 3-3 2 2-5 6z"/>',
    penalty_missed:'<path d="M3 20V4h18v16M7 4v7m5-7v7m5-7v7M3 9h18m-7 7 6 6m0-6-6 6"/><circle cx="6" cy="18" r="3"/>',
  };
  function eventIcon(kind) { return eventSymbols[kind] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${eventSymbols[kind]}</svg>` : esc(types[kind]?.tag || '•'); }
  const shareWebsite = 'https://fftql.team';
  const textEmoji = {goal:'⚽',assist:'👟',yellow:'🟨',red:'🟥',cs:'🧤',cs_lost:'🧤❌',dc:'💪',bonus:'⭐',penalty_saved:'🧤⚽',penalty_missed:'❌⚽'};
  let textCopyTimer = null;
  let ownersByCode = new Map(), ownershipFingerprint = '', ownershipSnapshot = null;
  const stableCode = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(Number(value)) : null;
  function renderOwnershipNote() {
    const note = $('ownershipNote'); if (!note) return;
    note.textContent = ownershipSnapshot
      ? `球员归属：${ownershipSnapshot.meta.leagueName || '当前 Draft 联赛'} · ${ownershipSnapshot.meta.stale ? '上次成功同步的' : '当前'}持有阵容（历史事件也显示当前归属）。`
      : '球员归属按当前 Draft 联赛匹配；归属尚未确认时不会标为自由球员。';
  }
  function setLeagueSnapshot(snapshot) {
    const requestedLeague = stableCode(new URLSearchParams(location.search).get('league'));
    const leagueId = stableCode(snapshot?.meta?.leagueId);
    const valid = leagueId && (!requestedLeague || leagueId === requestedLeague)
      && Array.isArray(snapshot?.players) && Array.isArray(snapshot?.managers);
    const next = new Map();
    if (valid) {
      const managers = new Map(snapshot.managers.filter(m => stableCode(m.entryId)).map(m => [stableCode(m.entryId), m.entryName || m.playerName || null]));
      for (const player of snapshot.players) {
        // snapshot.photo is Draft's official player code, NOT an element ID.
        const code = stableCode(player.photo); if (!code) continue;
        const label = player.owner === null ? '自由球员' : managers.get(stableCode(player.owner)) || '归属待确认';
        next.set(code, next.has(code) ? '归属待确认' : label);
      }
    }
    const fingerprint = JSON.stringify([valid ? leagueId : null, valid ? snapshot.meta.leagueName : '', valid && Boolean(snapshot.meta.stale), [...next]]);
    if (fingerprint === ownershipFingerprint) return;
    ownershipFingerprint = fingerprint; ownersByCode = next; ownershipSnapshot = valid ? snapshot : null;
    renderOwnershipNote();
    if (data) {
      const anchor = renderer?.captureAnchor(root);
      renderFeed({preserve:true});
      renderer?.restoreAnchor(anchor);
    }
  }
  function eventPlayerIdentity(event) {
    const match = fixtures().find(fixture => fixture.id === event.fixtureId);
    const team = [match?.home, match?.away].find(team => team && team.id === event.player?.team);
    const name = event.player?.name || '球员';
    const owner = ownersByCode.get(stableCode(event.player?.code)) || '归属待确认';
    return {name: team?.short_name ? `${name} (${team.short_name})` : name, owner, playerName:name, club:team?.short_name || ''};
  }
  function eventPlayerName(event) {
    const {name, owner} = eventPlayerIdentity(event);
    return `${name} · ${owner}`;
  }
  function eventPlayerHtml(event) {
    const {playerName, club, owner} = eventPlayerIdentity(event);
    const style = owner === '自由球员' ? 'is-free' : owner === '归属待确认' ? 'is-unknown' : 'is-owned';
    const palette = ['#D85B36','#2F6FED','#3E7C4F','#88599D','#AB7824','#20847D'];
    let hash = 0;
    for (const char of owner) hash = (Math.imul(hash,31) + char.charCodeAt(0)) >>> 0;
    const color = style === 'is-free' || style === 'is-unknown' ? '#7B8880' : palette[hash % palette.length];
    return `<span class="event-player-identity"><span class="event-player-name">${esc(playerName)}</span>${club ? `<span class="event-player-club">${esc(club)}</span>` : ''}</span><span class="event-owner-tag ${style}" style="--owner-color:${color}">${esc(owner)}</span>`;
  }
  function shareParts(event) { return (event.members || [event]).map(member=>({
    tag:textEmoji[member.kind] || '•', icon:member.kind,
    title:eventPlayerName(member), points:signed(member.points),
  })); }
  async function shareText(eventId, button) {
    const event=eventsForScope().find(e=>String(e.id)===eventId); if(!event)return;
    const text=shareParts(event).map(p=>`${p.title} ${p.tag} ${p.points}`).join('\n')+'\n'+shareWebsite;
    button.disabled=true;
    try {
      if(!navigator.clipboard?.writeText)throw Error('当前浏览器不支持自动复制');
      await navigator.clipboard.writeText(text);
      button.textContent='已复制';
      $('updateAnnouncement').textContent='文字已复制，可粘贴到微信群。';
    } catch (_) {
      // Keep the exact text available on insecure origins / denied clipboard access.
      window.prompt('自动复制未完成，请手动复制以下内容：',text);
    } finally {
      button.disabled=false;
      clearTimeout(textCopyTimer);
      textCopyTimer=setTimeout(()=>{root.querySelectorAll('[data-text-share]').forEach(b=>{b.textContent='复制';});},1800);
    }
  }
  root.querySelectorAll('[data-event-icon]').forEach(node => { node.innerHTML = eventIcon(node.dataset.eventIcon); });
  const shareSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/></svg>';
  let data = null, selected = null, day = 'all', matchFilter = 'all', eventFilter = 'all', limit = 18, loading = false;
  let nextAutomaticAt = 0;
  let completedExpanded = false, completedGw = null;
  let requestedGw = /^\d{1,2}$/.test(new URLSearchParams(location.search).get('gw') || '') ? Number(new URLSearchParams(location.search).get('gw')) : null;
  if (requestedGw && (requestedGw < 1 || requestedGw > 38)) requestedGw = null;
  // This zero-height sticky affordance does not push a reader's current card down.
  if (document.createElement && $('feed').before) {
    const updates = document.createElement('div'); updates.className = 'live-feed-updates';
    const button = document.createElement('button'); button.id = 'showNewEvents'; button.type = 'button'; button.hidden = true;
    button.addEventListener('click', () => {
      pendingEvents.clear(); holdFeed = false; renderFeed();
      $('feed').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
      const firstShare = $('feed').querySelector?.('[data-text-share]'); firstShare?.focus({preventScroll:true});
    });
    updates.append(button); $('feed').before(updates);
  }
  let stars = new Set();
  try { const saved = JSON.parse(localStorage.getItem('tql-matchday-stars-2026') || '[]'); if (Array.isArray(saved)) stars = new Set(saved.filter(Number.isInteger)); } catch (_) {}
  const finished = match => Boolean(match.finished || match.finished_provisional);
  const live = match => match.started && !finished(match);
  const teamName = team => chineseTeams[team?.short_name] || team?.name || '球队待确认';
  const matchName = match => `${teamName(match.home)} vs ${teamName(match.away)}`;
  function status(match) { return finished(match) ? 'FT' : live(match) ? (Number(match.minutes) > 0 ? `${match.minutes}′` : 'LIVE') : match.kickoff_time ? clockTime(match.kickoff_time).slice(0,5) : '待定'; }
  function score(match, side) { const n = match[`team_${side}_score`]; return match.started && n != null && Number.isFinite(Number(n)) ? String(n) : '—'; }
  // Original marks are archived in Obsidian. Official badges use FPL's stable
  // team.code, never the season-dependent team.id or a short-name guess.
  const failedBadges = new Set();
  root.addEventListener('error', event => {
    const image = event.target;
    if (!image?.matches?.('img[data-club-badge]')) return;
    failedBadges.add(image.dataset.clubBadge);
    const holder = image.closest('.crest');
    if (holder) { holder.className = 'crest crest--fallback'; holder.textContent = image.dataset.clubShort || 'PL'; holder.title = '官方队徽暂时无法加载'; }
  }, true);
  function crest(team) {
    const label = String(team?.short_name || 'PL').slice(0, 5);
    const code = /^[1-9]\d{0,5}$/.test(String(team?.code ?? '')) ? String(team.code) : null;
    if (!code || failedBadges.has(code)) return `<span class="crest crest--fallback" title="${esc(teamName(team))} · 队徽暂不可用" aria-hidden="true">${esc(label)}</span>`;
    const src = `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`;
    return `<span class="crest crest--official" title="${esc(teamName(team))} · FPL 官方队徽" aria-hidden="true"><img src="${src}" data-club-badge="${code}" data-club-short="${esc(label)}" alt="" width="34" height="34" decoding="async" loading="lazy" referrerpolicy="no-referrer"></span>`;
  }
  function redCards(match, side) {
    const n = match.redCards?.[side];
    return Number.isInteger(n) && n > 0 ? `<span class="team-red-card" aria-label="${n} 张红牌">${eventIcon('red')}${n > 1 ? n : ''}</span>` : '';
  }
  function saveStars() { try { localStorage.setItem('tql-matchday-stars-2026',JSON.stringify([...stars])); } catch (_) {} }
  function fixtures() { return data?.fixtures || []; }
  function visibleMatches() { return fixtures().filter(m => (day === 'all' || dayKey(m.kickoff_time) === day) && (matchFilter !== 'live' || live(m)) && (matchFilter !== 'starred' || stars.has(m.id))); }
  function eventsForScope() {
    const ids = new Set(visibleMatches().filter(m => selected == null || m.id === selected).map(m => m.id));
    const sorted = (data?.events || []).filter(e => ids.has(e.fixtureId) && (eventFilter === 'all' ? types[e.kind]?.group !== 'other' : types[e.kind]?.group === eventFilter)).sort((a,b) => {
      if (Boolean(a.baseline) !== Boolean(b.baseline)) return a.baseline ? 1 : -1;
      const time = (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0);
      if (time) return time;
      // Equal detection timestamps are one polling batch, not a known event sequence.
      // Keep source order; never group by G/A or fabricate minute-by-minute times.
      return 0;
    });
    // There is no goal-to-assist identifier upstream. Combine a team's update batch,
    // but retain all named components and never imply a fabricated one-to-one pairing.
    const groups = new Map();
    const groupKey = e => ['goal','assist'].includes(e.kind) && e.player?.team
      ? `${e.fixtureId}:${e.player.team}:${e.baseline?'baseline':e.observedAt}:${Number(e.delta)<0||Number(e.points)<0?'revision':'award'}` : null;
    for (const e of sorted) { const key=groupKey(e); if(key) { if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e); } }
    const emitted=new Set();
    return sorted.flatMap(e=>{
      const key=groupKey(e), members=groups.get(key);
      if(!members?.some(x=>x.kind==='goal') || !members.some(x=>x.kind==='assist')) return [e];
      if(emitted.has(key))return []; emitted.add(key);
      return [{...e,kind:'ga',members,points:null}];
    });
  }
  function renderMatches() {
    const phase = match => finished(match) ? 2 : live(match) ? 0 : 1;
    const kickoff = match => Number.isFinite(Date.parse(match.kickoff_time)) ? Date.parse(match.kickoff_time) : Number.MAX_SAFE_INTEGER;
    const items = visibleMatches().sort((a,b) => phase(a)-phase(b) || kickoff(a)-kickoff(b) || a.id-b.id);
    if (completedGw !== data?.meta?.gw) { completedGw = data?.meta?.gw; completedExpanded = false; }
    if (selected != null && !items.some(m => m.id === selected)) selected = null;
    $('matchCount').textContent = fixtures().length;
    $('liveFilterCount').textContent = fixtures().filter(live).length;
    $('liveCount').textContent = fixtures().some(live) ? `${fixtures().filter(live).length} 场进行中` : '当前无比赛进行';
    $('liveCount').parentElement.dataset.live = String(fixtures().some(live));
    const matchHtml = m => {
      const hs = score(m,'h'), as = score(m,'a');
      const winner = finished(m) && hs !== '—' && as !== '—' && Number(hs) !== Number(as) ? Number(hs) > Number(as) ? 'winner-home' : 'winner-away' : '';
      const state = data.meta.stale ? 'missing' : live(m) ? 'live' : finished(m) ? data.meta.settled ? 'final' : 'pending' : 'upcoming';
      const label = data.meta.stale ? '数据延迟' : live(m) ? status(m) : finished(m) ? data.meta.settled ? '完赛' : '待结算' : status(m);
      const stateLabel = {missing:'数据延迟',live:'赛中',final:'已完赛',pending:'待结算',upcoming:'未开赛'}[state];
      const kickoffLabel = m.kickoff_time ? clockTime(m.kickoff_time).slice(0,5) : '待定';
      // The minute is the official field, never an elapsed-time estimate.
      const minute = state === 'live' && Number(m.minutes) > 0 ? `<small class="score-minute">${esc(m.minutes)}′</small>` : '';
      return `<div data-live-key="match:${m.id}" data-state="${state}" class="match-item${selected === m.id ? ' selected' : ''}"><button class="match-select" data-live-key="select:${m.id}" data-match="${m.id}" aria-pressed="${selected === m.id}" aria-label="${esc(matchName(m))}，${esc(label)}，${hs} 比 ${as}，查看动态"><time class="match-time"${m.kickoff_time ? ` datetime="${esc(m.kickoff_time)}"` : ''}>${esc(kickoffLabel)}</time><span class="team home-team"><span class="team-label"><span class="team-name">${esc(teamName(m.home))}</span>${redCards(m,'home')}</span>${crest(m.home)}</span><span data-live-key="score:${m.id}" class="score-pair ${!m.started?'muted':''} ${winner}"><span>${hs}</span><b aria-hidden="true">–</b><span>${as}</span>${minute}</span><span class="team away-team">${crest(m.away)}<span class="team-label"><span class="team-name">${esc(teamName(m.away))}</span>${redCards(m,'away')}</span></span><span class="match-state-badge">${esc(stateLabel)}</span></button><button class="star" data-live-key="star:${m.id}" data-star="${m.id}" aria-pressed="${stars.has(m.id)}" aria-label="${stars.has(m.id)?'取消关注':'关注'}${esc(matchName(m))}">${stars.has(m.id)?'★':'☆'}</button></div>`;
    };
    const ongoing = items.filter(live), upcoming = items.filter(m => !live(m) && !finished(m)), completed = items.filter(finished);
    const group = (label, matches, css) => matches.length ? `<section data-live-key="${css}" class="score-group ${css}" aria-label="${label}"><h3 class="score-group-heading">${label}<span>${matches.length} 场</span></h3>${matches.map(matchHtml).join('')}</section>` : '';
    patch('matches', group('正在进行',ongoing,'score-group-live') + group('即将开赛',upcoming,'score-group-upcoming')
      + (completed.length ? `<section data-live-key="score-group-completed" class="score-group score-group-completed" aria-label="已完赛"><button type="button" id="toggleCompletedMatches" class="completed-matches-toggle" data-completed-toggle aria-expanded="${completedExpanded}" aria-controls="completedMatches"><span>已完赛 <small>${completed.length} 场</small></span><span class="completed-toggle-hint">${completedExpanded?'收起':'展开'}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span></button><div id="completedMatches"${completedExpanded?'':' hidden'}>${completed.map(matchHtml).join('')}</div></section>` : '')
      || `<div class="empty-state"><strong>${matchFilter==='starred'?'还没有关注比赛':matchFilter==='live'?'暂无正在进行的比赛':'这一天没有赛程'}</strong>${matchFilter==='starred'?'点击比赛旁的星星即可关注。':'切换「全部」或其他比赛日查看赛程。'}</div>`);
    $('allMatches').classList.toggle('active',selected == null);
    root.querySelectorAll('[data-match-filter]').forEach(b => b.setAttribute('aria-pressed',b.dataset.matchFilter === matchFilter));
  }
  function renderDates() {
    const dates = [...new Set(fixtures().map(m => dayKey(m.kickoff_time)))].sort();
    if (day !== 'all' && !dates.includes(day)) day = 'all';
    patch('dayChoices', '<button data-live-key="day:all" data-day="all" aria-pressed="'+(day==='all')+'"><span>全部</span><b>本轮 '+fixtures().length+' 场</b></button>' + dates.map(d => {
      const fixture = fixtures().find(m => dayKey(m.kickoff_time) === d);
      const weekday = d === 'tbd' ? '未定日期' : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date(fixture.kickoff_time));
      return `<button data-live-key="day:${d}" data-day="${d}" aria-pressed="${d===day}"><span>${shortDate(fixture.kickoff_time)}</span><b>${weekday}</b></button>`;
    }).join(''));
    const index = ['all',...dates].indexOf(day);
    $('previousDay').disabled = index <= 0;
    $('nextDay').disabled = index >= dates.length;
  }
  function describeEvent(event) {
    const type = types[event.kind] || {tag:'FPL',label:'计分更新',cls:'',group:'all'};
    const match = fixtures().find(m => m.id === event.fixtureId);
    const player = event.player || {};
    const team = match?.home?.id === player.team ? match.home : match?.away?.id === player.team ? match.away : null;
    if(event.members) return {type,match,team,player,points:null,title:'进球／助攻',
      members:event.members.map(describeEvent),detail:event.baseline?'本场进球与助攻累计，未提供逐球配对。':'同队、同批次的进球与助攻更新；不代表逐球配对。'};
    const value = Number(event.value), points = event.points == null ? null : Number(event.points);
    const revision = !event.baseline && (Number(event.delta) < 0 || (points < 0 && !['yellow','red','cs_lost','penalty_missed'].includes(event.kind)));
    const eventLabel = event.kind === 'cs_lost' ? '失去零封分' : revision ? type.label+'修订' : type.label;
    const title = `${eventPlayerName(event)} · ${eventLabel}`;
    const titleHtml = `${eventPlayerHtml(event)} · ${esc(eventLabel)}`;
    let detail = event.baseline ? `本场累计 ${Number.isFinite(value)?value:'—'}${event.kind==='dc'?' 次防守贡献':event.kind==='cs'?' 次零封':' 次'}，该项得分 ${signed(points)}。` : `官方该项计分变化 ${signed(points)}，本站在 ${clockTime(event.observedAt)} 检测到更新。`;
    if(event.kind === 'cs_lost') detail = '此前已获得的零封分被撤回；以球员个人的官方计分变化为准。';
    if(event.kind === 'dc') detail += ' 每场达标 +2，不与总分重复累加。';
    if(event.kind === 'assist') detail += ' FPL 助攻判定可能在赛后修订。';
    if(event.kind === 'red') detail += ' 红牌扣分包含黄牌；这些事件不可简单相加为总分。';
    if(event.kind === 'bonus') detail = `官方 Bonus 奖励分${event.baseline?'累计':'变化'} ${signed(points)}，并非 BPS 指标；以官方最终结算为准。`;
    if(['penalty_saved','penalty_missed'].includes(event.kind)) detail = `${type.label}${event.baseline?'累计':'计分变化'} ${signed(points)} 分，以官方球员计分明细为准，不与总分重复累加。`;
    if(points == null) detail = '已获取官方比赛统计，该项积分尚待同步，不以 0 分代替。';
    return {type,match,team,title,titleHtml,detail,points,value,player,revision};
  }
  function renderFeed({preserve = false} = {}) {
    const match = fixtures().find(m => m.id === selected);
    $('scopeText').textContent = match ? matchName(match) : matchFilter === 'starred' ? '已关注的比赛' : day === 'all' ? '本轮全部比赛' : day === 'tbd' ? '开球时间待定' : `${day} 的比赛`;
    patch('selectedMatch', match ? `<div class="selected-summary"><div><span>${esc(teamName(match.home))}</span><strong>${score(match,'h')} : ${score(match,'a')}</strong><span>${esc(teamName(match.away))}</span></div><button id="clearSelected" aria-label="取消比赛筛选">${esc(status(match))} ×</button></div>` : '');
    const all = eventsForScope();
    const scope = JSON.stringify([data.meta.gw,day,matchFilter,eventFilter,selected]);
    if (scope !== feedScope) { feedScope = scope; seenEvents.clear(); pendingEvents.clear(); holdFeed = false; }
    if (!preserve) { pendingEvents.clear(); holdFeed = false; }
    const plan = renderer?.feedPlan(all, seenEvents, pendingEvents, preserve && (holdFeed || pendingEvents.size > 0));
    pendingEvents = plan?.pending || new Set();
    const available = plan?.visible || all, items = available.slice(0,limit);
    seenEvents = new Set(all.map(eventKey));
    const updateButton = $('showNewEvents');
    if (updateButton) {
      updateButton.hidden = pendingEvents.size === 0;
      updateButton.textContent = `${pendingEvents.size} 条新动态 · 点击查看 ↑`;
    }
    patch('feed', items.map((e, index) => {
      const x = describeEvent(e), negative = x.points < 0;
      const detected = e.baseline ? '本场累计' : `${shortDate(e.observedAt)} ${clockTime(e.observedAt).slice(0,5)}`;
      const divider = e.baseline && (!index || !items[index-1].baseline) ? '<div data-live-key="time:baseline" class="timeline-label">首次同步摘要<span>以下为累计数据，无法还原发生先后</span></div>' : '';
      const components = x.members ? `<div class="goal-components">${e.members.map((member,i)=>{const m=x.members[i];return `<div class="goal-component"><span class="component-icon" aria-label="${esc(m.type.label)}">${eventIcon(member.kind)}</span><span class="component-player">${eventPlayerHtml(member)}</span><b class="points-chip ${m.points<0?'negative':''}">${signed(m.points)} 分</b></div>`;}).join('')}</div>` : '';
      const eventLabel = x.revision ? `${x.type.label}修订` : x.type.label;
      const title = x.members ? '<h3 class="event-group-title">进球 / 助攻</h3>' : `<h3>${eventPlayerHtml(e)}</h3>`;
      return `${divider}<article data-live-key="${esc(eventKey(e))}" class="event-card event-${x.type.cls}" title="${esc(x.detail)}"><span class="event-icon ${x.type.cls}" aria-label="${esc(x.type.label)}">${eventIcon(e.kind)}</span><div class="event-copy">${title}${components}<p class="event-detail sr-only">${esc(x.detail)} ${esc(x.match?matchName(x.match):'比赛')} · ${data.meta.stale?'数据延迟':data.meta.settled?'FPL 已结算':'FPL 暂定 / 可修订'}</p></div><div class="event-result">${x.members?'<span class="event-result-group">逐人计分</span>':`<strong class="event-points ${negative?'negative':x.points==null?'is-pending':''}" aria-label="该项得分 ${esc(signed(x.points))} 分">${esc(signed(x.points))}</strong>`}<span class="event-observation"><span class="event-minute" title="本站检测时间，非官方事件发生时间">${esc(detected)}</span><span class="event-type-label">${esc(eventLabel)}</span></span></div><div class="event-share-actions"><button data-live-key="text:${esc(eventKey(e))}" data-text-share="${esc(e.id)}" aria-label="文字分享：${esc(x.title)}" title="复制事件文字">复制</button><button data-live-key="share:${esc(eventKey(e))}" data-share="${esc(e.id)}" aria-label="图片分享：${esc(x.title)}" title="分享事件图片">图片</button></div></article>`;
    }).join('') || `<div class="empty-state"><strong>${match && !match.started?'等待比赛开始':'暂无匹配动态'}</strong>${match && !match.started?'开赛后在这里跟进球员表现与得分。':eventFilter !== 'all'?'当前筛选下还没有官方计分记录。':'默认展示进球／助攻、红黄牌与零封；更多计分请点「其他」。'}</div>`);
    $('feedFoot').textContent = `已展示 ${items.length} / ${all.length} 条${all.some(e=>e.baseline)?'动态与累计摘要':'动态'}${pendingEvents.size?' · '+pendingEvents.size+' 条新动态待查看':''}`;
    $('loadMore').hidden = items.length >= available.length;
    root.querySelectorAll('[data-event-filter]').forEach(b => b.setAttribute('aria-pressed',b.dataset.eventFilter === eventFilter));
  }
  let matchUpdates = null, updatesGw = undefined;
  function renderConnection() {
    const statusLabels = {connecting:'连接中',reconnecting:'正在重连',offline:'已离线',polling:'定时同步',paused:'同步暂停',syncing:'同步中'};
    const prefix = transportFailed || data?.meta.stale ? '数据延迟' : statusLabels[streamState] || '';
    $('snapshotTime').textContent = data
      ? data.meta.selectionPending ? `GW${data.meta.gw} 上次数据 · ${transportFailed || streamState === 'offline' ? '当前轮次待确认' : '正在确认当前轮次'} · ${clockTime(data.meta.updated)}`
        : `${prefix ? prefix+' · ' : ''}${shortDate(data.meta.updated)} ${clockTime(data.meta.updated)} 数据`
      : prefix || '正在连接官方数据';
    $('snapshotTime').parentElement.classList.toggle('stale',Boolean(transportFailed || data?.meta.stale || data?.meta.selectionPending || ['offline','reconnecting'].includes(streamState)));
    // Live is a connection condition, not a promise that FPL's source is current.
    $('snapshotTime').parentElement.setAttribute?.('data-connection',streamState || 'connecting');
  }
  function connectUpdates() {
    if (!active || !window.TQLUpdates || !data || (requestedGw && requestedGw !== Number(data.meta.gw)) || (matchUpdates && updatesGw === requestedGw)) return;
    matchUpdates?.close(); updatesGw = requestedGw;
    const channelGw = requestedGw;
    matchUpdates = window.TQLUpdates.connect({
      url: `/api/updates?channel=discover${requestedGw ? '&gw=' + requestedGw : ''}`,
      initialRevision: data.meta.revision, initialStale: Boolean(data.meta.stale),
      onUpdate: () => refresh(true),
      onStatus: state => { if (channelGw === requestedGw && active) { streamState = state.status; renderConnection(); scheduleRefresh(); } },
      onChecked: state => {
        if (!data || !state.updated || channelGw !== requestedGw) return;
        data.meta.updated = state.updated; data.meta.stale = state.stale;
        if (state.checkedAt) data.meta.checkedAt = state.checkedAt;
        if (state.nextRefreshAt) data.meta.nextRefreshAt = state.nextRefreshAt;
        if ('retryAt' in state) data.meta.retryAt = state.retryAt;
        if (typeof state.refreshing === 'boolean') data.meta.refreshing = state.refreshing;
        if (refreshStatusPending && !data.meta.refreshing && !data.meta.selectionPending && !transportFailed) {
          refreshStatusPending = false;
          refreshStatus(data.meta.stale ? '官方数据暂时延迟，已保留上次成功同步的数据。' : '已检查，比赛数据已同步。');
        }
        nextAutomaticAt = transportFailed ? Math.min(nextAutomaticAt,nextCheckTime(data.meta)) : nextCheckTime(data.meta);
        renderConnection();
        scheduleRefresh();
      },
    });
  }
  function render(previous = null, {preserve = false} = {}) {
    const seconds = Number(data.meta.refreshSeconds);
    const defaults = {match:10,finalizing:60,history:900,idle:10800};
    const interval = Number.isFinite(seconds) && seconds > 0 ? seconds : defaults[data.meta.refreshMode];
    const cadence = interval >= 3600 ? `${interval / 3600} 小时` : interval >= 60 ? `${interval / 60} 分钟` : `${interval} 秒`;
    const modeLabels = {
      match:`赛中每 ${cadence}检查 · 有变化自动推送`,
      finalizing:`赛后结算每 ${cadence}检查 · 更正自动同步`,
      history:`历史轮次每 ${cadence}核验 · 有变化自动同步`,
      idle:`非比赛时每 ${cadence}检查 · 开赛自动跟进`,
    };
    root.querySelector('.source-label').textContent = `官方 FPL 数据 · ${data.meta.selectionPending ? '当前轮次确认中 · 保留上次数据' : modeLabels[data.meta.refreshMode] || '按赛程同步 · 有变化自动推送'}`;
    renderConnection();
    const options = data.gameweeks || [];
    const optionHtml = options.map(g => `<option value="${Number(g.id)}"${Number(g.id) === Number(data.meta.gw)?' selected':''}>GW${Number(g.id)}${data.meta.selectionPending && Number(g.id) === Number(data.meta.gw)?' · 上次数据':''}</option>`).join('');
    if ($('gwSelect').innerHTML !== optionHtml) {
      // Never replace an open native picker just because another match minute ticked.
      if ((root.activeElement || document.activeElement) !== $('gwSelect')) patch('gwSelect',optionHtml);
    }
    if ((root.activeElement || document.activeElement) !== $('gwSelect')) $('gwSelect').value = String(data.meta.gw);
    $('gwSelect').disabled = false;
    $('shareRound').disabled = false;
    notice([
      data.meta.selectionPending ? `当前显示 GW${data.meta.gw} 的上次数据，正在确认最新赛程与当前轮次，不代表该轮仍在进行。` : '',
      data.meta.stale ? '官方数据同步暂时延迟，当前保留上一次成功获取的比分与源时间，请稍后刷新。' : '',
      data.meta.ignoredReferences > 0 ? '部分历史球员关联尚无法核验，已暂时省略，不补造数据。' : '',
      data.meta.historyTruncated ? '本轮动态较多，仅保留最近 2,000 条已观测记录。' : '',
    ].filter(Boolean).join(' '));
    const fixturesChanged = !previous || previous.meta.gw !== data.meta.gw || JSON.stringify(previous.fixtures) !== JSON.stringify(data.fixtures);
    if (fixturesChanged) { renderDates(); renderMatches(); }
    if (fixturesChanged || !previous || previous.meta.stale !== data.meta.stale || previous.meta.settled !== data.meta.settled
      || JSON.stringify(previous.events) !== JSON.stringify(data.events) || (!preserve && pendingEvents.size > 0)) renderFeed({preserve});
    if (previous?.meta.gw === data.meta.gw && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
      const oldMatches = new Map(previous.fixtures.map(match => [match.id,match]));
      for (const match of fixtures()) {
        const old = oldMatches.get(match.id);
        if (old?.started && match.started && (score(old,'h') !== score(match,'h') || score(old,'a') !== score(match,'a'))) {
          root.querySelector(`[data-live-key="score:${match.id}"]`)?.animate?.(
            [{backgroundColor:'#d9ef9e',color:'#12382a',boxShadow:'0 0 0 4px #d9ef9e'}, {backgroundColor:'transparent',boxShadow:'0 0 0 0px transparent'}],
            {duration:2200,easing:'ease-out'});
        }
      }
    }
  }
  function notice(message) { $('dataNotice').hidden = !message; $('dataNotice').textContent = message; }
  function refreshStatus(message) {
    const status = $('refreshStatus');
    if (status) { status.textContent = message; status.hidden = !message; }
  }
  function showManualRefresh(sequence) {
    manualRefreshSequence = sequence;
    $('refreshData').classList.add('updating');
    $('refreshData').setAttribute('aria-busy','true');
    $('refreshData').disabled = true;
    refreshStatus('正在刷新比赛数据…');
  }
  function refresh(silent = false) {
    silent = silent === true;
    if(!active) return Promise.resolve(false);
    const gw = requestedGw;
    if(loading && requestGw === gw) {
      // Reuse the active read, but make the user's click visible and reveal
      // buffered events when it completes, even if it began as a silent push.
      if (!silent) showManualRefresh(requestSequence);
      return inFlight || Promise.resolve(false);
    }
    requestAbort?.abort();
    const sequence = ++requestSequence;
    requestAbort = typeof AbortController === 'function' ? new AbortController() : null;
    const controller = requestAbort, timeout = controller ? setTimeout(()=>controller.abort(),45000) : null;
    requestGw = gw;
    loading=true;
    if (!silent) showManualRefresh(sequence);
    // The GW picker remains operable while fetching; the next choice cancels this request.
    if (data && gw && gw !== Number(data.meta.gw)) notice(`正在加载 GW${gw}，当前仍显示 GW${data.meta.gw} 的数据。`);
    inFlight = (async () => {
    try {
      const preload = !data && !gw && window.__fplInitialMatchCentre;
      if (preload) delete window.__fplInitialMatchCentre;
      let next;
      if (preload) {
        const initial = await preload;
        if (initial.error) throw initial.error;
        next = initial.data;
      } else {
        const response = await fetch(`/api/match-centre${gw?'?gw='+gw:''}`,{signal:controller?.signal || AbortSignal.timeout(45000),cache:'no-store'});
        if(!response.ok) throw Error(`HTTP ${response.status}`);
        next = await response.json();
      }
      if(!next.meta || !Array.isArray(next.fixtures) || !Array.isArray(next.events)) throw Error('Invalid match data');
      if(gw !== requestedGw || sequence !== requestSequence || !active) return false;
      if(gw && Number(next.meta.gw) !== gw) throw Error('Mismatched match round');
      const manual = manualRefreshSequence === sequence;
      const preserve = silent && !manual;
      const oldGw = data?.meta.gw;
      if (preserve && oldGw && Number(oldGw) !== Number(next.meta.gw) && (root.activeElement || document.activeElement) === $('gwSelect')) return false;
      const previous = data;
      const changed = !next.meta.revision || next.meta.gw !== data?.meta.gw || next.meta.revision !== data?.meta.revision || next.meta.stale !== data?.meta.stale;
      const anchor = preserve ? renderer?.captureAnchor(root) : null;
      const feedTop = $('feed').getBoundingClientRect?.().top;
      holdFeed = Boolean(preserve && previous && oldGw === next.meta.gw && Number.isFinite(feedTop) && feedTop < 120);
      const hadPendingEvents = pendingEvents.size > 0;
      data = {...next,meta:{...next.meta,settled:next.meta.finished === true && next.meta.data_checked === true}};
      transportFailed = false; failures = 0;
      nextAutomaticAt = nextCheckTime(next.meta);
      if(oldGw && Number(oldGw)!==Number(next.meta.gw)) { selected=null;day='all';limit=18;seenEvents.clear();pendingEvents.clear();holdFeed=false; }
      render(previous,{preserve});
      if (changed) renderer?.restoreAnchor(anchor);
      connectUpdates();
      if (!data.meta.refreshing && !data.meta.selectionPending) matchUpdates?.acknowledge?.({revision:data.meta.revision,stale:Boolean(data.meta.stale),updated:data.meta.updated,checkedAt:data.meta.checkedAt});
      if (manual || refreshStatusPending) {
        refreshStatusPending = Boolean(next.meta.refreshing || next.meta.selectionPending);
        refreshStatus(refreshStatusPending ? '后台正在同步官方数据，完成后会自动更新。'
          : next.meta.stale ? '官方数据暂时延迟，已保留上次成功同步的数据。'
            : !previous || changed || hadPendingEvents ? '已同步最新可用比赛数据。' : '已检查，暂无新动态。');
      }
      if (manual || pendingEvents.size) $('updateAnnouncement').textContent = pendingEvents.size ? `${pendingEvents.size} 条新动态，点击新动态按钮查看。` : next.meta.stale?'当前显示上次成功同步的数据':'比赛数据已同步';
      return data.meta.refreshing || data.meta.selectionPending ? false : {revision:data.meta.revision,stale:Boolean(data.meta.stale),updated:data.meta.updated,checkedAt:data.meta.checkedAt};
    } catch (error) {
      if (sequence !== requestSequence || gw !== requestedGw || !active) return false;
      const anchor = renderer?.captureAnchor(root);
      nextAutomaticAt = Date.now() + Math.min(60000,5000 * 2 ** Math.min(failures++,4));
      transportFailed = true;
      if (manualRefreshSequence === sequence || refreshStatusPending) {
        refreshStatusPending = false;
        refreshStatus('刷新未成功，已保留原有数据，可再次点击重试。');
      }
      notice(data ? '暂时无法同步官方数据，已保留原有比分与更新时间。稍后会自动重试。' : '官方数据暂时未能加载，请点击刷新重试；不会以零分代替缺失数据。');
      if(!data) { $('matches').innerHTML='<div class="empty-state">赛程暂未加载，请稍后刷新。</div>'; $('feed').innerHTML='<div class="empty-state">尚未获取到官方事件数据。</div>'; $('snapshotTime').textContent='连接暂时不可用'; }
      else {
        if (gw && gw !== Number(data.meta.gw)) {
          notice(`GW${gw} 暂时无法加载，当前继续显示 GW${data.meta.gw} 的原有数据，可重新选择轮次重试。`);
          requestedGw=Number(data.meta.gw); matchUpdates?.close(); matchUpdates=null; connectUpdates();
        }
        $('gwSelect').value=String(data.meta.gw); renderConnection();
      }
      renderer?.restoreAnchor(anchor);
      return false;
    } finally {
      if(timeout !== null) clearTimeout(timeout);
      if(sequence === requestSequence) { loading=false; inFlight=null; requestAbort=null; $('refreshData').classList.remove('updating'); $('refreshData').setAttribute('aria-busy','false'); $('refreshData').disabled=false; $('gwSelect').disabled=!data; scheduleRefresh(); }
    }
    })();
    return inFlight;
  }
  function share(eventId) {
    if(!data || !window.TQLShare) return;
    const items = eventId ? eventsForScope().filter(e=>String(e.id)===eventId) : eventsForScope();
    if(eventId) {
      if(!items.length)return;
      window.TQLShare.open({compact:true,events:shareParts(items[0]),meta:{...data.meta,stale:Boolean(data.meta.stale || transportFailed || data.meta.selectionPending),demo:false}},root);
      return;
    }
    const matchId = eventId ? items[0]?.fixtureId : selected;
    const match = fixtures().find(m=>m.id===matchId);
    window.TQLShare.open({title:'比赛进展',subtitle:`GW${data.meta.gw}${data.meta.selectionPending?' 上次数据':''} · ${$('scopeText').textContent} · ${eventId?'单条事件':items.length>5?'当前筛选前 5 条':'当前筛选'}`,meta:{...data.meta,stale:Boolean(data.meta.stale || transportFailed || data.meta.selectionPending),demo:false},score:match?{home:teamName(match.home),away:teamName(match.away),homeScore:score(match,'h'),awayScore:score(match,'a'),minute:status(match)}:null,events:items.map(e=>{const x=describeEvent(e);return{tag:x.type.tag,icon:e.kind,title:x.title,detail:`${x.match?matchName(x.match)+' · ':''}${x.members?x.members.map(m=>`${m.title} ${signed(m.points)} 分`).join('；')+'。':''}${x.detail}`,points:x.members?'分项':signed(x.points),time:e.baseline?'本场累计':'检测 '+clockTime(e.observedAt)};})}, root);
  }
  $('matches').addEventListener('click',e=>{
    if(e.target.closest('[data-completed-toggle]')) {
      completedExpanded = !completedExpanded; renderMatches();
      $('toggleCompletedMatches')?.focus({preventScroll:true}); return;
    }
    const star=e.target.closest('[data-star]');
    if(star){const id=Number(star.dataset.star);stars.has(id)?stars.delete(id):stars.add(id);saveStars();renderMatches();renderFeed();return;}
    const target=e.target.closest('[data-match]');if(!target)return;
    selected=Number(target.dataset.match);limit=18;renderMatches();renderFeed();
    if(matchMedia('(max-width:760px)').matches) root.querySelector('.events-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  });
  root.querySelector('.score-tools').addEventListener('click',e=>{const b=e.target.closest('[data-match-filter]');if(b){matchFilter=b.dataset.matchFilter;selected=null;limit=18;renderMatches();renderFeed();}});
  $('dayChoices').addEventListener('click',e=>{const b=e.target.closest('[data-day]');if(b){day=b.dataset.day;selected=null;limit=18;renderDates();renderMatches();renderFeed();}});
  function changeDay(direction){const keys=['all',...[...new Set(fixtures().map(m=>dayKey(m.kickoff_time)))].sort()];day=keys[Math.max(0,Math.min(keys.length-1,keys.indexOf(day)+direction))];selected=null;limit=18;renderDates();renderMatches();renderFeed();root.querySelector(`[data-day="${day}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}
  $('previousDay').addEventListener('click',()=>changeDay(-1));$('nextDay').addEventListener('click',()=>changeDay(1));
  root.querySelector('.event-filters').addEventListener('click',e=>{const b=e.target.closest('[data-event-filter]');if(b){eventFilter=b.dataset.eventFilter;limit=18;renderFeed();}});
  $('allMatches').addEventListener('click',()=>{selected=null;renderMatches();renderFeed();});
  $('selectedMatch').addEventListener('click',e=>{if(e.target.closest('#clearSelected')){selected=null;renderMatches();renderFeed();}});
  $('feed').addEventListener('click',e=>{
    const textButton=e.target.closest('[data-text-share]');
    if(textButton){shareText(textButton.dataset.textShare,textButton);return;}
    const b=e.target.closest('[data-share]');if(b)share(b.dataset.share);
  });
  $('shareRound').addEventListener('click',()=>share());$('loadMore').addEventListener('click',()=>{limit+=24;renderFeed({preserve:true});});
  $('refreshData').addEventListener('click',() => refresh(false));
  $('gwSelect').addEventListener('change',()=>{
    requestedGw=Number($('gwSelect').value); selected=null;day='all';limit=18;
    matchUpdates?.close(); matchUpdates=null; streamState='connecting'; refresh();
  });
  $('showLeagueGuide').addEventListener('click',()=>$('guideDialog').showModal());$('showFeedback')?.addEventListener('click',()=>$('feedbackDialog').showModal());
  root.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeDialog).close()));
  $('leagueForm')?.addEventListener('submit',e=>{
    const raw=$('leagueId').value.trim();let id=/^\d{1,10}$/.test(raw)?raw:null;
    if(!id){try{const url=new URL(raw);if(url.protocol==='https:'&&url.hostname==='draft.premierleague.com')id=url.pathname.match(/\/league\/(\d{1,10})(?:\/|$)/)?.[1];}catch(_){}}
    if(!id || Number(id)<1){e.preventDefault();$('leagueId').setCustomValidity('请输入有效联赛 ID，或官方 Draft 联赛链接');$('leagueId').reportValidity();return;}
    $('leagueId').setCustomValidity('');$('leagueId').value=String(Number(id));
    try{localStorage.setItem('tql-last-matchday-league',String(Number(id)));}catch(_){}
  });
  $('leagueId')?.addEventListener('input',()=>$('leagueId').setCustomValidity(''));
  try{const recent=localStorage.getItem('tql-last-matchday-league');if(/^\d{1,10}$/.test(recent||'')&&Number(recent)>0)$('recentLeagueLink').href=`/?league=${Number(recent)}#weekly`;}catch(_){}
  refresh();
  function canRead() { return active && document.visibilityState==='visible' && navigator.onLine !== false; }
  function nextCheckTime(meta) {
    const retryAt = Date.parse(meta.retryAt);
    if (Number.isFinite(retryAt) && retryAt > Date.now()) return retryAt;
    if (meta.refreshing || meta.selectionPending) return Date.now() + 7500;
    if (meta.stale) return Date.now() + 60000;
    const due = Date.parse(meta.nextRefreshAt), interval = Number(meta.refreshSeconds) * 1000;
    return Number.isFinite(due) ? Math.max(Date.now() + 1000,Math.min(due,Date.now() + 10800000))
      : Date.now() + (Number.isFinite(interval) && interval > 0 ? interval : 60000);
  }
  function scheduleRefresh() {
    clearTimeout(fallbackTimer); fallbackTimer = null;
    if (!canRead()) return;
    // A healthy stream owns data delivery. This watchdog is a clock, not a poll.
    const waitingOnStream = matchUpdates?.healthy() && !transportFailed && !data?.meta.refreshing && !data?.meta.selectionPending;
    const delay = waitingOnStream ? 60000 : Math.max(1000,Math.min(60000,nextAutomaticAt - Date.now()));
    fallbackTimer = setTimeout(maybeRefresh,delay);
  }
  function maybeRefresh() {
    if (canRead() && (!matchUpdates?.healthy() || transportFailed || data?.meta.refreshing || data?.meta.selectionPending) && Date.now() >= nextAutomaticAt) refresh(true);
    scheduleRefresh();
  }
  function resume() {
    if (canRead()) {
      if (matchUpdates?.catchUp) matchUpdates.catchUp();
      else refresh(true);
    }
    scheduleRefresh();
  }
  document.addEventListener('visibilitychange',resume);
  window.addEventListener?.('online',resume);
  window.addEventListener?.('pageshow',event=>{if(event.persisted)resume();});
  window.addEventListener?.('offline',()=>{streamState='offline';renderConnection();scheduleRefresh();});
  return { refresh, setLeagueSnapshot, setActive(value) {
    const nextActive = Boolean(value);
    if (nextActive === active) {
      // The host can repeat show(true) while its own league bootstrap settles.
      // That is not a return from another tab, so do not catch up twice after
      // consuming the early match-centre request. Failed first loads remain retryable.
      if (active) {
        connectUpdates();
        if (!loading && (!data || transportFailed) && canRead()) refresh(true);
        else if (!loading) scheduleRefresh();
      }
      return;
    }
    active = nextActive;
    if (!active) {
      matchUpdates?.close(); matchUpdates = null; requestAbort?.abort(); ++requestSequence;
      clearTimeout(fallbackTimer);fallbackTimer=null;
      loading=false; inFlight=null; requestAbort=null;
      refreshStatusPending = false; refreshStatus('');
      $('refreshData').classList.remove('updating'); $('refreshData').setAttribute('aria-busy','false'); $('refreshData').disabled=false;
    }
    else { connectUpdates(); resume(); }
  } };
  }
  window.TQLMatchCentre = { mount };
  if (document.getElementById('matches')) mount();
})();

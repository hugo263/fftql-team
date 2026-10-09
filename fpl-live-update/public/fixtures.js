/* Draft league calendar: official opponents, not Premier League club fixtures. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPLFixtures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { snapshot: null, start: null, manager: 'all', range: 6, detailGw: null, railStartGw: null, bound: false };
  function railWindow(available, selected, startGw = null, revealEdge = false) {
    if (!available.length) return [];
    const size = Math.min(7, available.length), lastStart = available.length - size;
    const selectedIndex = Math.max(0, available.indexOf(selected));
    const previousStart = available.indexOf(startGw);
    let start = previousStart < 0 ? Math.max(0, selectedIndex - 2) : previousStart;
    start = Math.min(start, lastStart);
    // Keep the existing window while selecting inside it. Edge clicks reveal just one neighbour.
    if (selectedIndex < start) start = Math.max(0, selectedIndex - 1);
    else if (selectedIndex >= start + size) start = Math.min(lastStart, selectedIndex - size + 2);
    else if (revealEdge && selectedIndex === start && start > 0) start--;
    else if (revealEdge && selectedIndex === start + size - 1 && start < lastStart) start++;
    return available.slice(start, start + size);
  }
  function chooseRound(gw) {
    const available = model(state.snapshot, state.start, state.range).available;
    if (!available.includes(gw)) return;
    state.railStartGw = railWindow(available, gw, state.railStartGw, true)[0] ?? null;
    state.detailGw = gw;
    render(state.snapshot);
    // On narrow screens reveal an off-screen choice minimally, never centre the whole rail.
    const container = document.getElementById('fxGwChoices');
    const button = container?.querySelector(`[data-round="${gw}"]`);
    if (button) {
      const item = button.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      if (item.left < viewport.left + 3) container.scrollLeft += item.left - viewport.left - 3;
      else if (item.right > viewport.right - 3) container.scrollLeft += item.right - viewport.right + 3;
    }
  }
  function schedule(snapshot) {
    const seen = new Set();
    return (snapshot.leagueSchedule || []).filter(m => {
      if (!Number.isInteger(m.gw) || m.gw < 1 || m.gw > 38) return false;
      const key = `${m.gw}:${[m.entry1Id ?? m.entry1, m.entry2Id ?? m.entry2].map(String).sort().join('|')}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => a.gw - b.gw);
  }
  function defaultGw(snapshot) {
    const rounds = [...new Set(schedule(snapshot).map(m => m.gw))];
    const target = snapshot.meta.reportLive ? snapshot.meta.reportGw : snapshot.meta.upcomingGw;
    return rounds.find(gw => gw >= target) || rounds.at(-1) || 0;
  }
  function opponent(match, id) {
    const left = match.entry1Id === id;
    if (!left && match.entry2Id !== id) return null;
    return { id: left ? match.entry2Id : match.entry1Id, name: left ? match.entry2 : match.entry1,
      ownPoints: left ? match.entry1Points : match.entry2Points, points: left ? match.entry2Points : match.entry1Points };
  }
  function result(match, id) {
    const other = opponent(match, id);
    if (!other || !match.started || !Number.isFinite(other.ownPoints) || !Number.isFinite(other.points)) return null;
    return other.ownPoints > other.points ? '胜' : other.ownPoints < other.points ? '负' : '平';
  }
  function model(snapshot, start, range, manager = 'all') {
    const matches = schedule(snapshot);
    const available = [...new Set(matches.map(m => m.gw))];
    const from = available.includes(Number(start)) ? Number(start) : defaultGw(snapshot);
    const gws = available.filter(gw => gw >= from).slice(0, range);
    const managers = [...(snapshot.managers || [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.entryId - b.entryId)
      .filter(m => manager === 'all' || m.entryId === Number(manager));
    return { matches, available, from, gws, managers };
  }
  function dateText(snapshot, gw, short = false) {
    const date = new Date((snapshot.events || []).find(e => e.id === gw)?.deadline || '');
    if (!Number.isFinite(date.getTime())) return '时间待定';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      ...(short ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }) }).format(date);
  }
  function phase(snapshot, gw) {
    if (snapshot.meta.reportLive && gw === snapshot.meta.reportGw) return '进行中';
    if (gw <= snapshot.meta.lastFinishedGw) return snapshot.meta.reportFinalizing && gw === snapshot.meta.reportGw ? '完赛 · 待结算' : '已完赛';
    return '未开赛';
  }
  function managerSeason(snapshot, managerId) {
    return schedule(snapshot).filter(m => opponent(m, Number(managerId)))
      .map(match => ({ match, ...opponent(match, Number(managerId)) }));
  }
  function rankText(manager) {
    return Number.isInteger(manager?.rank) && manager.rank > 0 ? `当前 #${manager.rank}` : '排名暂无';
  }
  function managerColor(manager) {
    // Use the same name-based palette as the match-centre owner labels.
    if (!manager?.entryName) return '#7B8880';
    const palette = ['#D85B36','#2F6FED','#3E7C4F','#88599D','#AB7824','#20847D'];
    let hash = 0;
    for (const char of String(manager?.entryName || '')) hash = (Math.imul(hash,31) + char.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }
  function managerDot(manager) {
    return `<i class="fx-manager-dot" style="--manager-color:${managerColor(manager)}" aria-hidden="true"></i>`;
  }
  function rankBadge(manager) {
    return Number.isInteger(manager?.rank) && manager.rank > 0 ? `#${manager.rank}` : '—';
  }
  function difficulty(rank, count) {
    // Relative current-rank quintiles only; never invent official FDR values.
    if (!Number.isInteger(rank) || rank < 1 || rank > count || count < 2) return 0;
    return 5 - Math.min(4, Math.floor((rank - 1) * 5 / count));
  }
  function phaseState(snapshot, gw) {
    const label = phase(snapshot, gw);
    return label === '进行中' ? 'live' : label.includes('待结算') ? 'pending' : label === '已完赛' ? 'final' : 'upcoming';
  }
  function managerChoices(managers, selected) {
    return managers.map(m => `<button type="button" class="fx-manager-choice" data-manager="${Number(m.entryId)}" aria-pressed="${String(m.entryId) === selected}" aria-controls="fxManagerSeason" title="${esc(m.entryName)} · ${esc(m.playerName)} · ${rankText(m)}">${managerDot(m)}<span class="fx-manager-identity"><b>${esc(m.entryName)}</b><small>${esc(m.playerName)}</small></span><span class="fx-manager-rank" aria-label="${rankText(m)}">${rankBadge(m)}</span></button>`).join('');
  }
  function matchTeam(match, side, managers, selected) {
    const id = match[`entry${side}Id`], manager = managers.get(id);
    return `<span class="fx-match-team ${String(id) === selected ? 'fx-following' : ''}">${managerDot(manager)}<span class="fx-match-identity"><b>${esc(match[`entry${side}`])}</b><small>${manager?.playerName ? `${esc(manager.playerName)} · ` : ''}<span class="fx-current-rank">${rankText(manager)}</span></small></span></span>`;
  }
  function savedManager(snapshot, storage) {
    try {
      const value = (storage || localStorage).getItem(`fpl-fixtures-manager:${snapshot.meta.leagueId}`);
      return snapshot.managers.some(m => String(m.entryId) === value) ? value : 'all';
    } catch { return 'all'; }
  }
  function saveManager(snapshot, value, storage) {
    if (!snapshot.managers.some(m => String(m.entryId) === value)) return;
    try { (storage || localStorage).setItem(`fpl-fixtures-manager:${snapshot.meta.leagueId}`, value); } catch { /* Private mode must not block selection. */ }
  }
  function render(snapshot) {
    const $ = id => document.getElementById(id);
    if (!$('fxTable')) return;
    const previous = state.snapshot;
    if (!previous || previous.meta.leagueId !== snapshot.meta.leagueId) {
      state.start = null; state.manager = savedManager(snapshot); state.detailGw = null; state.railStartGw = null;
    }
    state.snapshot = snapshot;
    if (!snapshot.managers.some(m => String(m.entryId) === state.manager)) state.manager = 'all';
    const view = model(snapshot, state.start, state.range);
    const allManagers = new Map(snapshot.managers.map(m => [m.entryId, m]));
    const choices = managerChoices(view.managers, state.manager);
    if ($('fxManagerChoices').innerHTML !== choices) $('fxManagerChoices').innerHTML = choices;
    $('fxGw').innerHTML = view.available.map(gw => `<option value="${gw}">GW${gw}</option>`).join('');
    $('fxGw').value = String(view.from);
    const detailGw = view.available.includes(state.detailGw) ? state.detailGw : defaultGw(snapshot);
    $('fxMatchGw').innerHTML = view.available.map(gw => `<option value="${gw}">GW${gw}</option>`).join('');
    $('fxMatchGw').value = String(detailGw);
    const selectedIndex = view.available.indexOf(detailGw);
    const railGws = railWindow(view.available, detailGw, state.railStartGw);
    state.railStartGw = railGws[0] ?? null;
    const railRoot = $('fxGwChoices');
    const existing = [...railRoot.querySelectorAll('[data-round]')];
    if (existing.length !== railGws.length || existing.some((button, index) => Number(button.dataset.round) !== railGws[index])) {
      railRoot.innerHTML = railGws.map(gw => `<button type="button" class="fx-gw-pill" data-round="${gw}" data-state="${phaseState(snapshot, gw)}" aria-pressed="${gw === detailGw}" aria-controls="fxRounds"><b>GW${gw}</b><small>${phase(snapshot, gw)}</small></button>`).join('');
    } else {
      // Preserve button nodes, their positions and focus during ordinary selection/data refresh.
      existing.forEach(button => {
        const gw = Number(button.dataset.round);
        button.setAttribute('aria-pressed', String(gw === detailGw));
        button.dataset.state = phaseState(snapshot, gw);
        button.querySelector('small').textContent = phase(snapshot, gw);
      });
    }
    $('fxMatchPrev').disabled = selectedIndex <= 0;
    $('fxMatchNext').disabled = selectedIndex < 0 || selectedIndex === view.available.length - 1;
    $('fxMatchReset').disabled = !view.available.length;
    $('fxDetailTitle').textContent = detailGw ? `GW${detailGw} · 全部对阵` : '每轮对阵';
    $('fxDetailMeta').innerHTML = detailGw ? `<span class="fx-state" data-state="${phaseState(snapshot, detailGw)}">${phase(snapshot, detailGw)}</span><span>阵容截止 ${dateText(snapshot, detailGw)} · 北京时间</span>` : '';
    $('fxRange').value = String(state.range);
    $('fxPrev').disabled = view.from === view.available[0] || !view.available.length;
    $('fxNext').disabled = view.from === view.available.at(-1) || !view.available.length;
    const isClassic = snapshot.meta.scoring === 'c';
    $('fxSummary').innerHTML = isClassic ? '<strong>Classic 积分制联赛</strong><span>此联赛没有经理之间的 H2H 对阵赛程。</span>'
      : !view.gws.length ? '<strong>赛程暂未同步</strong><span>等待官方公布联赛对阵，不自动编排对手。</span>'
      : `<strong>${view.managers.length} 位经理 · ${view.gws.length} 轮</strong><span class="fx-summary-round">GW${view.from}<span>—</span>GW${view.gws.at(-1)}</span><small>按对手当前联赛排名着色</small>`;
    if (isClassic || !view.gws.length) { $('fxTable').innerHTML = ''; $('fxRounds').innerHTML = '<p class="fx-note">暂无官方 H2H 对阵。</p>'; $('fxManagerSeason').innerHTML = '<p class="fx-note">暂无可查看的经理赛程。</p>'; $('fxManagerMeta').textContent = ''; return; }
    const managerCell = m => `<th scope="row"><button type="button" class="fx-team-pick" data-manager="${Number(m.entryId)}" title="${esc(m.entryName)} · ${rankText(m)}">${managerDot(m)}<b>${esc(m.entryName)}</b><span class="fx-team-rank">${rankBadge(m)}</span></button></th>`;
    $('fxTable').style.minWidth = `${176 + view.gws.length * 104}px`;
    $('fxTable').innerHTML = `<thead><tr><th scope="col">经理 / 排名</th>${view.gws.map(gw => `<th scope="col" class="${gw === defaultGw(snapshot) ? 'fx-current-gw' : ''}"><button type="button" data-gw="${gw}">GW${gw}<small>${dateText(snapshot, gw, true)}</small></button></th>`).join('')}</tr></thead><tbody>${view.managers.map(m => `<tr>${managerCell(m)}${view.gws.map(gw => {
      const meetings = view.matches.filter(match => match.gw === gw && opponent(match, m.entryId));
      return `<td>${meetings.length ? meetings.map(match => {
        const other = opponent(match, m.entryId);
        const rank = allManagers.get(other.id)?.rank;
        const score = result(match, m.entryId);
        return `<button type="button" class="fx-opponent ${gw === defaultGw(snapshot) ? 'fx-current-gw' : ''}" data-gw="${gw}" data-difficulty="${difficulty(rank, allManagers.size)}" title="GW${gw} · ${esc(other.name)}${rank ? ` · 当前第 ${rank} 名` : ' · 排名暂无'}"><b>${esc(other.name)}</b><small>${rank ? `#${rank}` : '排名暂无'}${score ? ` · ${match.finished ? '' : '暂计 '}${score} ${other.ownPoints}−${other.points}` : ''}</small></button>`;
      }).join('') : '<span class="fx-no-match">暂无对阵</span>'}</td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
    const selectedManager = allManagers.get(Number(state.manager));
    const season = selectedManager ? managerSeason(snapshot, selectedManager.entryId) : [];
    $('fxManagerMeta').textContent = selectedManager ? `${selectedManager.entryName} · ${rankText(selectedManager)} · ${season.length} 场` : '点击经理，查看整季对手';
    $('fxManagerSeason').innerHTML = !selectedManager ? '<p class="fx-manager-empty">选择一位经理，查看从第一轮到赛季末的所有对手。</p>'
      : !season.length ? '<p class="fx-manager-empty">这位经理暂无官方对阵。</p>' : `<table class="fx-season-table"><thead><tr><th>GW</th><th>对手</th><th>截止时间 · 北京</th><th>比分 / 状态</th></tr></thead><tbody>${season.map(row => {
        const match = row.match;
        const score = result(match, selectedManager.entryId);
        return `<tr class="${match.gw === defaultGw(snapshot) ? 'fx-next-round' : ''}"><th scope="row">GW${match.gw}</th><td><span class="fx-season-opponent">${managerDot(allManagers.get(row.id))}<span><b>${esc(row.name)}</b><small>${rankText(allManagers.get(row.id))}</small></span></span></td><td>${dateText(snapshot, match.gw)}</td><td><b class="fx-season-result" data-result="${score || 'upcoming'}">${score ? `${row.ownPoints} − ${row.points} · ${match.finished ? '' : '暂计 '}${score}` : 'VS'}</b><small>${phase(snapshot, match.gw)}</small></td></tr>`;
      }).join('')}</tbody></table>`;
    const rounds = [detailGw];
    $('fxRounds').innerHTML = rounds.map(gw => {
      const games = view.matches.filter(m => m.gw === gw);
      return `<section class="fx-round" aria-label="GW${gw} ${phase(snapshot, gw)}">${games.length ? games.map(match => {
        const scored = match.started && Number.isFinite(match.entry1Points) && Number.isFinite(match.entry2Points);
        const detail = match.entry1Id > 0 && match.entry2Id > 0;
        const team = side => matchTeam(match, side, allManagers, state.manager);
        const winner = scored && match.finished ? Math.sign(match.entry1Points - match.entry2Points) : 0;
        return `<${detail ? 'button type="button"' : 'div'} class="fx-match" data-state="${phaseState(snapshot, gw)}" ${detail ? `data-match-gw="${gw}" data-match-left="${match.entry1Id}" data-match-right="${match.entry2Id}" aria-haspopup="dialog" aria-label="查看 GW${gw} ${esc(match.entry1)} 对阵 ${esc(match.entry2)}${scored ? `，比分 ${match.entry1Points} 比 ${match.entry2Points}` : ''}"` : ''}>${team(1)}<span class="fx-match-score ${scored ? 'fx-scored' : 'fx-upcoming'}"><strong>${scored ? `<span class="${winner > 0 ? 'is-winner' : winner < 0 ? 'is-loser' : ''}">${match.entry1Points}</span><i aria-hidden="true">−</i><span class="${winner < 0 ? 'is-winner' : winner > 0 ? 'is-loser' : ''}">${match.entry2Points}</span>` : 'VS'}</strong><small>${phase(snapshot, gw)}</small></span>${team(2)}${detail ? '<span class="fx-match-arrow" aria-hidden="true">↗</span>' : ''}</${detail ? 'button' : 'div'}>`;
      }).join('') : '<p class="fx-note">此轮暂无官方对阵安排。</p>'}</section>`;
    }).join('');
    if (state.bound) return;
    state.bound = true;
    $('fxManagerChoices').addEventListener('click', e => {
      const button = e.target.closest('[data-manager]');
      if (!button) return;
      state.manager = button.dataset.manager; saveManager(state.snapshot, state.manager); render(state.snapshot);
      $('fxManagerChoices').querySelector(`[data-manager="${Number(state.manager)}"]`)?.focus({preventScroll:true});
    });
    $('fxMatchGw').addEventListener('change', e => chooseRound(Number(e.target.value)));
    $('fxGwChoices').addEventListener('click', e => {
      const button = e.target.closest('[data-round]');
      if (!button) return;
      chooseRound(Number(button.dataset.round));
      $('fxGwChoices').querySelector(`[data-round="${state.detailGw}"]`)?.focus({preventScroll:true});
    });
    for (const [id, delta] of [['fxMatchPrev', -1], ['fxMatchNext', 1]]) $(id).addEventListener('click', () => {
      const v = model(state.snapshot, state.start, state.range);
      const current = v.available.includes(state.detailGw) ? state.detailGw : defaultGw(state.snapshot);
      chooseRound(v.available[v.available.indexOf(current) + delta] ?? current);
    });
    $('fxMatchReset').addEventListener('click', () => { state.railStartGw = null; chooseRound(defaultGw(state.snapshot)); state.detailGw = null; });
    $('fxGw').addEventListener('change', e => { state.start = Number(e.target.value); render(state.snapshot); });
    $('fxRange').addEventListener('change', e => { state.range = Number(e.target.value); render(state.snapshot); });
    for (const [id, delta] of [['fxPrev', -1], ['fxNext', 1]]) $(id).addEventListener('click', () => {
      const v = model(state.snapshot, state.start, state.range, state.manager);
      state.start = v.available[v.available.indexOf(v.from) + delta] ?? v.from; render(state.snapshot);
    });
    $('fxReset').addEventListener('click', () => { state.start = null; render(state.snapshot); });
    $('fxTable').addEventListener('click', e => {
      const team = e.target.closest('[data-manager]');
      if (team) { state.manager = team.dataset.manager; saveManager(state.snapshot, state.manager); render(state.snapshot); $('fxManagerPanel').scrollIntoView({block:'start', behavior:'smooth'}); return; }
      const round = e.target.closest('[data-gw]');
      if (round) { chooseRound(Number(round.dataset.gw)); $('fxDetailTitle').scrollIntoView({block:'start', behavior:'smooth'}); }
    });
  }
  return { render, model, schedule, opponent, result, defaultGw, dateText, managerSeason, rankText, managerChoices, matchTeam, savedManager, saveManager, railWindow };
});

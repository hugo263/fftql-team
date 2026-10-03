'use strict';

const form = document.querySelector('#leagueForm');
const input = document.querySelector('#leagueIdInput');
const errorBox = document.querySelector('#formError');
const buildButton = document.querySelector('#buildButton');
const recentButton = document.querySelector('#recentButton');
const recentLeagueId = document.querySelector('#recentLeagueId');
const RECENT_LEAGUE_KEY = 'fpl_recent_league_id';

function validLeagueId(value) {
  const raw = String(value || '').trim();
  if (/^\d{1,10}$/.test(raw) && Number(raw) > 0) return raw;
  const pathMatch = raw.match(/(?:\/api)?\/league\/(\d{1,10})(?:\/|$|[?#])/i);
  if (pathMatch && Number(pathMatch[1]) > 0) return pathMatch[1];
  const queryMatch = raw.match(/[?&]league=(\d{1,10})(?:&|$|#)/i);
  return queryMatch && Number(queryMatch[1]) > 0 ? queryMatch[1] : null;
}

function enterWorkspace(value) {
  const id = validLeagueId(value);
  if (!id) {
    errorBox.textContent = '请输入数字联赛 ID，或粘贴包含 /league/ID/ 的官方链接。';
    input.focus();
    return;
  }
  errorBox.textContent = '';
  buildButton.disabled = true;
  buildButton.querySelector('span').textContent = '正在进入工作台…';
  try { localStorage.setItem(RECENT_LEAGUE_KEY, id); } catch (error) { /* storage unavailable */ }
  window.location.assign(`/?league=${id}`);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  enterWorkspace(input.value);
});

input.addEventListener('input', () => {
  errorBox.textContent = '';
});

input.addEventListener('paste', () => {
  setTimeout(() => {
    const id = validLeagueId(input.value);
    if (id) input.value = id;
  }, 0);
});

document.querySelector('#exampleButton').addEventListener('click', () => enterWorkspace('47275'));

let recentId = null;
try { recentId = validLeagueId(localStorage.getItem(RECENT_LEAGUE_KEY)); } catch (error) { recentId = null; }
if (recentId) {
  recentLeagueId.textContent = `#${recentId}`;
  recentButton.hidden = false;
  recentButton.addEventListener('click', () => enterWorkspace(recentId));
}

const initialLeague = validLeagueId(new URLSearchParams(window.location.search).get('league'));
if (initialLeague) enterWorkspace(initialLeague);

'use strict';

// Read-only audit: writes nothing on the machine where it executes. Run via
// `ssh HOST node < scripts/audit-defcon.cjs` to avoid local proxy artifacts.
const draft = 'https://draft.premierleague.com/api';
const classic = 'https://fantasy.premierleague.com/api';
const sources = [];
async function get(url) {
  const start = new Date().toISOString();
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const data = await response.json();
  sources.push({ url, requestedAt: start, receivedAt: new Date().toISOString() });
  return data;
}
function breakdown(el) {
  return (el?.explain || []).flatMap((fixture) => {
    const id = Array.isArray(fixture) ? fixture[1] : fixture.fixture;
    const stats = Array.isArray(fixture) ? fixture[0] : fixture.stats;
    return (stats || []).map((item) => ({fixture: id, stat: item.stat || item.identifier, points: item.points, value: item.value}));
  });
}
function duplicates(rows, key) {
  const seen = new Set(); const dup = [];
  for (const row of rows) { if (seen.has(row[key])) dup.push(row[key]); seen.add(row[key]); }
  return dup;
}
(async () => {
  const [db, cb] = await Promise.all([get(`${draft}/bootstrap-static`), get(`${classic}/bootstrap-static/`)]);
  const gw = cb.events.filter((event) => Date.parse(event.deadline_time) <= Date.now()).at(-1)?.id;
  if (!gw) throw new Error('No current gameweek');
  const classicByCode = new Map(cb.elements.map((row) => [row.code, row]));
  const summary = { auditedAt: new Date().toISOString(), gw,
    counts: {draft: db.elements.length, classic: cb.elements.length},
    duplicateDraftCodes: duplicates(db.elements, 'code'), duplicateClassicCodes: duplicates(cb.elements, 'code'),
    unmappedDraftPlayers: db.elements.filter((row) => !classicByCode.has(row.code)).map((row) => ({id:row.id,code:row.code,name:row.web_name})),
    events: cb.events.filter((event) => event.id <= gw).map(({id,finished,data_checked,deadline_time}) => ({id,finished,data_checked,deadline_time})), rounds: [], sources };
  for (let round = 1; round <= gw; round++) {
    const [dl, cl] = await Promise.all([get(`${draft}/event/${round}/live`),get(`${classic}/event/${round}/live/`)]);
    const clById = new Map(cl.elements.map((row)=>[row.id,row]));
    const rows = db.elements.map((p)=>{
      const d = dl.elements[p.id]; const cmeta = classicByCode.get(p.code); const c = clById.get(cmeta?.id);
      const de = breakdown(d); const ce = breakdown(c);
      const dc = de.filter((item)=>/defensive.*contribution/i.test(item.stat));
      const cc = ce.filter((item)=>/defensive.*contribution/i.test(item.stat));
      return {id:p.id,classicId:cmeta?.id,code:p.code,name:p.web_name,pos:p.element_type,
        draftTotal:d?.stats?.total_points, classicTotal:c?.stats?.total_points, minutes:d?.stats?.minutes,
        draftExplainTotal:de.reduce((sum,item)=>sum+(Number.isFinite(item.points)?item.points:0),0),
        classicExplainTotal:ce.reduce((sum,item)=>sum+(Number.isFinite(item.points)?item.points:0),0),
        defensiveContribution:d?.stats?.defensive_contribution, classicDefensiveContribution:c?.stats?.defensive_contribution,
        draftDefcon:dc, classicDefcon:cc, draftExplain:de, classicExplain:ce};
    });
    const scored = rows.filter((row)=>row.minutes>0 || row.draftTotal);
    const contributors = rows.filter((row)=>row.draftDefcon.some((stat)=>stat.points>0)||row.classicDefcon.some((stat)=>stat.points>0));
    summary.rounds.push({gw:round, liveDraftCount:Object.keys(dl.elements).length,liveClassicCount:cl.elements.length,
      missingDraftStats:rows.filter((row)=>!Number.isFinite(row.draftTotal)||!Number.isFinite(row.minutes)).map(({id,name})=>({id,name})),
      duplicateClassicLiveIds:duplicates(cl.elements,'id'), playedCount:scored.length,
      totalDiscrepancies:rows.filter((row)=>row.draftTotal!==row.classicTotal),
      draftExplainDiscrepancies:scored.filter((row)=>row.draftTotal!==row.draftExplainTotal),
      classicExplainDiscrepancies:scored.filter((row)=>row.classicTotal!==row.classicExplainTotal),
      defconAwardedCount:contributors.length,
      contributors: contributors.map((row) => round === gw ? row : (({draftExplain,classicExplain,...compact})=>compact)(row)),
      statKeys:Object.keys(Object.values(dl.elements).find((row)=>row.stats?.minutes>0)?.stats||{})});
  }
  process.stdout.write(JSON.stringify(summary)+'\n');
})().catch((error)=>{ process.stderr.write(`${error.stack}\n`); process.exitCode=1; });

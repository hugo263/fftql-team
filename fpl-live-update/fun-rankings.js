'use strict';
const fs = require('fs');
const path = require('path');
const {resolveAutoSubs} = require('./auto-subs');
const {effectivePositions, validateGameweekFixtures} = require('./match-detail');

function benchRow(manager, payload, players, live, fixtures, teams, gw, finished, resolved) {
  effectivePositions(payload);
  for (const pick of payload.picks) {
    const stats = live?.elements?.[pick.element]?.stats;
    if (!players.has(pick.element) || !['minutes','total_points','yellow_cards','red_cards'].every(k => Number.isFinite(stats?.[k]))) throw Error('球员得分或阵容不完整');
  }
  const lineup = resolved || resolveAutoSubs(payload, players, live, fixtures, teams, {gw, finished});
  const bench = [...lineup.positions].filter(([,position])=>position>11).sort((a,b)=>a[1]-b[1]).map(([id,position])=>({
    id, position, name:players.get(id).name, team:players.get(id).team, pos:players.get(id).pos,
    points:live.elements[id].stats.total_points,
  }));
  if (bench.length !== 4) throw Error('替补席数据不完整');
  return {entryId:manager.entryId, entryName:manager.entryName, bench, benchPoints:bench.reduce((s,p)=>s+p.points,0), provisional:lineup.provisional};
}

// Only fully checked official rounds are frozen. The live round always uses
// this refresh's locked picks and the same autosub resolver as the match view.
async function collectFunRankings({snapshot, events, teams, fetchJson, draftApi, classicApi, cacheDir, squads, squadGwByEntry, ownershipPicksByGw, reportLive, reportFixtures, reportLineups,rawLiveByGw=new Map()}) {
  const {leagueId,season,reportGw} = snapshot.meta;
  const players = new Map(snapshot.players.map(p=>[p.id,p]));
  const rounds = [];
  const start = snapshot.meta.leagueStartGw || 1;
  for (let gw=start; gw<=reportGw; gw++) {
    const event=events.find(e=>e.id===gw);
    const settled=Boolean(event?.finished && event.data_checked!==false);
    const file=path.join(cacheDir,`fun-round-v1-league${leagueId}-season${season.replace(/[^0-9]/g,'')}-gw${gw}.json`);
    if (settled) {
      try {
        const saved=JSON.parse(fs.readFileSync(file,'utf8'));
        if (saved.version===1 && saved.leagueId===leagueId && saved.season===season && saved.gw===gw && saved.settled && saved.complete
          && saved.managers.length && saved.managers.every(m=>m.bench?.length===4 && Number.isFinite(m.benchPoints))) {rounds.push(saved);continue;}
      } catch (_) { /* Collect missing/invalid history without touching other caches. */ }
    }
    const round={version:1,leagueId,season,gw,settled:false,finished:false,started:false,complete:false,managers:[],missing:[],matches:snapshot.h2hByGw[gw]||[]};
    try {
      const liveFile=path.join(cacheDir,`fun-live-v1-season${season.replace(/[^0-9]/g,'')}-gw${gw}.json`);
      const readLive=async()=>{
        let live=rawLiveByGw.get(gw) || (gw===reportGw?reportLive:null);
        if(!live && settled){try{live=JSON.parse(fs.readFileSync(liveFile,'utf8'));}catch(_){/* first collection */}}
        if(!live?.elements)live=await fetchJson(`${draftApi}/event/${gw}/live`);
        if(settled && live?.elements){const temp=liveFile+`.${process.pid}.${require('crypto').randomUUID()}.tmp`;try{fs.writeFileSync(temp,JSON.stringify(live),{flag:'wx',mode:0o600});fs.renameSync(temp,liveFile);}catch(_){try{fs.unlinkSync(temp);}catch(_){}}}
        return live;
      };
      const [live, rawFixtures]=await Promise.all([
        readLive(),
        gw===reportGw && reportFixtures.length ? reportFixtures : fetchJson(`${classicApi}/fixtures/?event=${gw}`),
      ]);
      const fixtures=validateGameweekFixtures(rawFixtures,gw,teams);
      round.finished=fixtures.every(f=>f.finished||f.finished_provisional);
      round.started=fixtures.some(f=>f.started);
      if (round.started) {
        for(let i=0;i<snapshot.managers.length;i+=4) {
          const batch=await Promise.all(snapshot.managers.slice(i,i+4).map(async manager=>{
            try {
              const payload=squadGwByEntry.get(manager.entryId)===gw ? squads.get(manager.entryId)
                : ownershipPicksByGw.get(gw)?.get(manager.entryId) || await fetchJson(`${draftApi}/entry/${manager.entryId}/event/${gw}`);
              return benchRow(manager,payload,players,live,fixtures,teams,gw,round.finished,gw===reportGw?reportLineups.get(manager.entryId):null);
            } catch (_) {round.missing.push(manager.entryId);return null;}
          }));
          round.managers.push(...batch.filter(Boolean));
        }
      }
      round.complete=round.started && round.managers.length===snapshot.managers.length && round.missing.length===0;
      round.settled=settled && round.finished && round.complete && round.managers.every(m=>!m.provisional);
      if(round.settled) {
        const temp=file+`.${process.pid}.${require('crypto').randomUUID()}.tmp`;
        try {fs.writeFileSync(temp,JSON.stringify(round),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
        catch (_) {try{fs.unlinkSync(temp);}catch(_){/* no temporary file */}}
      }
    } catch (_) {round.missing=snapshot.managers.map(m=>m.entryId);}
    rounds.push(round);
  }
  return {version:1,rounds};
}
module.exports={benchRow,collectFunRankings};

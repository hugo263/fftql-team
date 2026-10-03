import { sql } from "../db.ts";
import { Bootstrap, clubName, FPL_SOURCE_URL, POSITIONS, priceDifferences, seasonOf } from "./data.ts";
import { publishFplChanges } from "./price-bulletins.ts";

/** Fetch first, then atomically compare with the last successful same-season observation. */
export async function collectFpl(): Promise<{players:number;changes:number}> {
  const res = await fetch(FPL_SOURCE_URL, {signal:AbortSignal.timeout(30_000),headers:{"User-Agent":"TQLNewsBot/1.0 (+https://news.fftql.team/about)"}});
  if (!res.ok) throw new Error(`FPL upstream ${res.status}`);
  const data = Bootstrap.parse(await res.json());
  const checkedAt = new Date();
  const season = seasonOf(data);
  const next = data.events.find(e=>e.is_next);
  const gw = next?.id ?? data.events.find(e=>e.is_current)?.id ?? null;
  const teams = new Map(data.teams.map(t=>[t.id,clubName(t.short_name,t.name)]));
  const prices = Object.fromEntries(data.elements.map(p=>[String(p.code),p.now_cost]));
  if (new Set(data.elements.map(p=>p.code)).size !== data.elements.length) throw new Error("Duplicate FPL player codes");
  const changes = await sql.begin(async tx=> {
    await tx`SELECT pg_advisory_xact_lock(77190201)`;
    const [previous] = await tx<{id:number;season:string;checked_at:Date;prices:Record<string,number>}[]>`SELECT id,season,checked_at,prices FROM fpl_observations ORDER BY checked_at DESC LIMIT 1`;
    if (previous && previous.checked_at >= checkedAt) return [];
    const diffs = previous?.season === season ? priceDifferences(previous.prices,prices) : [];
    const [observation] = await tx<{id:number}[]>`INSERT INTO fpl_observations(season,checked_at,prices,gameweek,next_deadline) VALUES(${season},${checkedAt},${tx.json(prices)},${gw},${next ? new Date(next.deadline_time):null}) RETURNING id`;
    const rows = data.elements.map(p=>({code:p.code,classic_id:p.id,season,name:p.web_name,full_name:`${p.first_name} ${p.second_name}`.trim(),team:teams.get(p.team)!,position:POSITIONS[p.element_type]??"未知",cost:p.now_cost,season_delta:p.cost_change_start,status:p.status,chance:p.chance_of_playing_next_round,news:p.news,news_added:p.news_added?new Date(p.news_added):null,checked_at:checkedAt}));
    if (rows.some(p=>!p.team)) throw new Error("Unknown FPL team");
    await tx`INSERT INTO fpl_players ${tx(rows)} ON CONFLICT(code) DO UPDATE SET classic_id=excluded.classic_id,season=excluded.season,name=excluded.name,full_name=excluded.full_name,team=excluded.team,position=excluded.position,cost=excluded.cost,season_delta=excluded.season_delta,status=excluded.status,chance=excluded.chance,news=excluded.news,news_added=excluded.news_added,checked_at=excluded.checked_at`;
    await tx`DELETE FROM fpl_players WHERE code NOT IN ${tx(data.elements.map(p=>p.code))}`;
    for (const d of diffs) {
      const player = rows.find(p=>p.code===d.code)!;
      await tx`INSERT INTO fpl_price_changes(observation_id,season,player_code,name,team,position,old_cost,new_cost,previous_checked_at,observed_at,gameweek) VALUES(${observation!.id},${season},${d.code},${player.name},${player.team},${player.position},${d.oldCost},${d.newCost},${previous!.checked_at},${checkedAt},${gw})`;
    }
    // Retain the original seasonal baseline and observations referenced by price changes.
    await tx`DELETE FROM fpl_observations WHERE checked_at < now()-interval '90 days' AND id NOT IN(SELECT observation_id FROM fpl_price_changes) AND id NOT IN(SELECT DISTINCT ON(season) id FROM fpl_observations ORDER BY season,checked_at)`;
    return diffs;
  });
  // Price records remain valid even if publishing fails; the next run repairs any missing feed item.
  await publishFplChanges();
  return {players:data.elements.length,changes:changes.length};
}

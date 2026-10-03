import { sql } from "../db.ts";
import { FPL_SOURCE_URL } from "../fpl/data.ts";
import type { FplPriceResponse } from "@aihot/contracts/fpl";

export async function loadFplPrices(filters:{q:string;direction:string;team:string}):Promise<FplPriceResponse> {
  const [latest] = await sql<{season:string;checked_at:Date;gameweek:number|null;next_deadline:Date|null}[]>`SELECT season,checked_at,gameweek,next_deadline FROM fpl_observations ORDER BY checked_at DESC LIMIT 1`;
  const season=latest?.season??null;
  const [base] = await sql<{at:Date|null}[]>`SELECT min(checked_at) at FROM fpl_observations WHERE season=${season}`;
  const pattern=`%${filters.q.replace(/[\\%_]/g,"\\$&")}%`;
  const whereChange=sql`season=${season} AND (${filters.q}='' OR name ILIKE ${pattern} OR team ILIKE ${pattern}) AND (${filters.team}='' OR team=${filters.team}) AND (${filters.direction}='all' OR (${filters.direction}='up' AND new_cost>old_cost) OR (${filters.direction}='down' AND new_cost<old_cost))`;
  const [changes,players,[changeCount],[playerCount],teams] = await Promise.all([
    sql`SELECT * FROM fpl_price_changes WHERE ${whereChange} ORDER BY observed_at DESC,id DESC LIMIT 100`,
    sql`SELECT * FROM fpl_players WHERE season=${season} AND (${filters.q}='' OR name ILIKE ${pattern} OR full_name ILIKE ${pattern} OR team ILIKE ${pattern}) AND (${filters.team}='' OR team=${filters.team}) ORDER BY cost DESC,name LIMIT 100`,
    sql`SELECT count(*) n FROM fpl_price_changes WHERE ${whereChange}`,
    sql`SELECT count(*) n FROM fpl_players WHERE season=${season} AND (${filters.q}='' OR name ILIKE ${pattern} OR full_name ILIKE ${pattern} OR team ILIKE ${pattern}) AND (${filters.team}='' OR team=${filters.team})`,
    sql`SELECT DISTINCT team FROM fpl_players WHERE season=${season} ORDER BY team`,
  ]);
  return {season,checkedAt:latest?.checked_at.toISOString()??null,baselineAt:base?.at?.toISOString()??null,gameweek:latest?.gameweek??null,nextDeadline:latest?.next_deadline?.toISOString()??null,changes:changes.map(c=>({id:c.id,code:c.player_code,name:c.name,team:c.team,position:c.position,oldCost:c.old_cost/10,newCost:c.new_cost/10,previousCheckedAt:c.previous_checked_at.toISOString(),observedAt:c.observed_at.toISOString(),gameweek:c.gameweek})),players:players.map(p=>({code:p.code,classicId:p.classic_id,name:p.name,fullName:p.full_name,team:p.team,position:p.position,cost:p.cost/10,seasonDelta:p.season_delta/10,status:p.status,chance:p.chance,news:p.news})),changesTotal:Number(changeCount?.n??0),playersTotal:Number(playerCount?.n??0),filters,teams:teams.map(t=>t.team),sourceUrl:FPL_SOURCE_URL};
}

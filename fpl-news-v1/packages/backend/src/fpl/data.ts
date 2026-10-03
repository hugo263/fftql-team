import { z } from "zod";
import { ENTITIES } from "@aihot/industry/taxonomy";

export const FPL_SOURCE_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const Player = z.object({
  code: z.number().int().positive(), id: z.number().int().positive(),
  web_name: z.string().min(1), first_name: z.string(), second_name: z.string(),
  team: z.number().int(), element_type: z.number().int(), now_cost: z.number().int().min(0).max(300),
  cost_change_start: z.number().int(), status: z.string(),
  chance_of_playing_next_round: z.number().nullable(), news: z.string(),
  news_added: z.string().nullable(),
});
export const Bootstrap = z.object({
  elements: z.array(Player).min(100),
  teams: z.array(z.object({id:z.number(), name:z.string(), short_name:z.string()})).length(20),
  events: z.array(z.object({id:z.number(), deadline_time:z.string(), is_next:z.boolean(), is_current:z.boolean()})).min(1),
});
export type FplBootstrap = z.infer<typeof Bootstrap>;
export const POSITIONS: Record<number,string> = {1:"门将",2:"后卫",3:"中场",4:"前锋"};
export function seasonOf(data: FplBootstrap): string {
  const start = new Date(data.events[0]!.deadline_time);
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid FPL season deadline");
  const year = start.getUTCFullYear() - (start.getUTCMonth() < 6 ? 1 : 0);
  return `${year}/${String(year+1).slice(-2)}`;
}
export function clubName(shortName:string, fallback:string): string {
  return ENTITIES[shortName.toLowerCase()]?.name ?? fallback;
}
export function priceDifferences(previous: Record<string,number>, current: Record<string,number>) {
  return Object.entries(current).flatMap(([code,cost]) => {
    const before = previous[code];
    return before !== undefined && before !== cost ? [{code:Number(code),oldCost:before,newCost:cost}] : [];
  });
}

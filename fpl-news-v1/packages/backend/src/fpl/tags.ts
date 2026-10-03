import { sql } from "../db.ts";
import { CATEGORIES, CATEGORY_TAGS } from "@aihot/industry/taxonomy";

export function withFplCategory(tags:string[],category:string|null|undefined):string[] {
  const label=CATEGORIES.find(c=>c.key===category)?.label;
  return label ? [label,...tags.filter(t=>!(CATEGORY_TAGS as readonly string[]).includes(t))] : tags;
}

type PlayerName = {name:string;full_name:string};
const literal = (s:string) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const commonWords = new Set(["white","young","cash","wood","long","king","will","gray","green"]);
/** Full names always qualify; short names must be unique and not common words. */
export function identifyPlayerTags(text:string, players:PlayerName[]):string[] {
  const counts=new Map<string,number>();
  for(const p of players) counts.set(p.name.toLowerCase(),(counts.get(p.name.toLowerCase())??0)+1);
  const matches:string[]=[];
  for(const p of players) {
    const aliases=[p.full_name,...(p.name.length>=4 && counts.get(p.name.toLowerCase())===1 && !commonWords.has(p.name.toLowerCase())?[p.name]:[])];
    if(aliases.some(a=>new RegExp(`(?:^|[^\\p{L}])${literal(a)}(?:$|[^\\p{L}])`,"iu").test(text))) matches.push(`球员:${p.name}`);
  }
  return [...new Set(matches)].slice(0,6);
}
let cached: {at:number;players:PlayerName[]}|null=null;
/** "Draft team" is a squad draft, not the FPL Draft game. Classic-only chips resolve it. */
export function withFplGameplay(text:string, tags:string[], addFallback=true):string[] {
  const classic = /\b(?:wild\s?card|free hit|triple captain|bench boost)\b|外卡|自由打击|三倍队长|替补(?:席)?加分/i.test(text);
  const draft = /\b(?:FPL\s+Draft|Draft\s+(?:league|mode)|waivers?|Fantrax|snake\s+draft)\b|Draft\s*联赛|选秀联赛|弃权(?:名单|优先权)/i.test(text);
  const result = classic ? [...tags.filter(t=>!["Classic","Draft","通用"].includes(t)), "Classic", ...(draft?["Draft"]:[])] : [...tags];
  if (result.includes("Classic") || result.includes("Draft")) return result.filter(t=>t!=="通用");
  return addFallback && !result.includes("通用") ? [...result,"通用"] : result;
}
export async function enrichFplTags(text:string,tags:string[],category?:string|null):Promise<string[]> {
  if(!cached || Date.now()-cached.at>600_000) cached={at:Date.now(),players:await sql<PlayerName[]>`SELECT name,full_name FROM fpl_players WHERE season=(SELECT season FROM fpl_observations ORDER BY checked_at DESC LIMIT 1)`};
  const gws=[...new Set([...text.matchAll(/\b(?:GW|Gameweek)\s*(\d{1,2})\b/gi)].map(m=>Number(m[1])).filter(g=>g>=1&&g<=38))].slice(0,4).map(g=>`GW${g}`);
  const result=[...new Set([...withFplGameplay(text,withFplCategory(tags,category)),...gws,...identifyPlayerTags(text,cached.players)])];
  if(!result.some(t=>["官方确认","媒体报道","预测","待核实"].includes(t))) result.push("待核实");
  return result;
}

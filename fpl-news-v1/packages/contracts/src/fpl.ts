export interface FplPlayer {
  code: number; classicId: number; name: string; fullName: string;
  team: string; position: string; cost: number; seasonDelta: number;
  status: string; chance: number | null; news: string;
}
export interface FplPriceChange {
  id: number; code: number; name: string; team: string; position: string;
  oldCost: number; newCost: number; previousCheckedAt: string; observedAt: string;
  gameweek: number | null;
}
/** One successful official observation, not a calendar-day price prediction. */
export interface FplPriceBatch {
  observationId: number;
  season: string;
  observedAt: string;
  previousCheckedAt: string;
  gameweek: number | null;
  changes: FplPriceChange[];
}
export interface FplPriceResponse {
  season: string | null; checkedAt: string | null; baselineAt: string | null;
  gameweek: number | null; nextDeadline: string | null;
  changes: FplPriceChange[]; players: FplPlayer[];
  changesTotal: number; playersTotal: number;
  filters: { q: string; direction: string; team: string };
  teams: string[];
  sourceUrl: string;
}

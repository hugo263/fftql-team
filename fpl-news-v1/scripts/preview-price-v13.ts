// Isolated UI fixtures; never run against a production database.
import { sql, closeDb } from '../packages/backend/src/db.ts';
import { publishFplChanges } from '../packages/backend/src/fpl/price-bulletins.ts';
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_preview_test')) throw Error('Preview database required');
const at=new Date(),before=new Date(at.getTime()-600000);
const [obs]=await sql`INSERT INTO fpl_observations(season,checked_at,prices,gameweek) VALUES('2026/27',${at},'{}',6) RETURNING id`;
for(const [code,name,team,oldCost,newCost] of [[10001,'预览球员 A','ARS',60,61],[10002,'预览球员 B','MCI',70,69],[10003,'预览球员 C','LIV',80,81]] as const) {
  await sql`INSERT INTO fpl_price_changes(observation_id,season,player_code,name,team,position,old_cost,new_cost,previous_checked_at,observed_at,gameweek)
    VALUES(${obs!.id},'2026/27',${code},${name},${team},'中场',${oldCost},${newCost},${before},${at},6)`;
}
console.log(await publishFplChanges());await closeDb();

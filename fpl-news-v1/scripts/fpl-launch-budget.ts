// Conservative first-release request limits; pricing remains the provider's actual token pricing.
// Run explicitly after seeding the dedicated news database. Re-running is an intentional reset.
import {sql,closeDb} from "@aihot/backend/db";
await sql`UPDATE budgets SET per_minute=8,per_hour=120,per_day=300,note='TQL 第一版模型请求上限；超额等待下个窗口' WHERE service='llm'`;
console.log("TQL launch limits: 8/minute, 120/hour, 300/day");
await closeDb();

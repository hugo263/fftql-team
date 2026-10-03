// One real recovery run. Normal collector writes success only after parsing/storage succeed.
import {collectSource} from '../packages/backend/src/sources/collect.ts';
import {sql,closeDb} from '../packages/backend/src/db.ts';
import {stopBoss} from '../packages/backend/src/jobs/queue.ts';
try {
  console.log(await collectSource('rss-allaboutfpl',{force:true}));
  console.log(await sql`SELECT id,health,fail_count,last_ok_at,last_error FROM sources WHERE id='rss-allaboutfpl'`);
} finally {await stopBoss();await closeDb();}

// Apply deterministic gameplay fixes to existing news, without any model call.
import { sql, closeDb } from "@aihot/backend/db";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
try {
  const rows=await sql<{article_id:string}[]>`SELECT article_id FROM publications WHERE visibility='public'`;
  let changed=0;
  for(const row of rows) {
    if ((await publishArticle(row.article_id))?.changed) changed++;
  }
  console.log(`Updated gameplay tags for ${changed} article(s)`);
} finally {await stopBoss();await closeDb();}

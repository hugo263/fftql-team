// A standalone local cluster for tests. No access to any production database.
import EmbeddedPostgres from "/private/tmp/tql-pg-test-runtime/node_modules/embedded-postgres/dist/index.js";
import { mkdirSync,writeFileSync,mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
const password=randomBytes(24).toString("base64url");
const pg=new EmbeddedPostgres({databaseDir:mkdtempSync('/private/tmp/tql-news-test-'),user:"tql_test",password,port:15439,persistent:false,onLog:()=>{},onError:()=>{}});
await pg.initialise();
await pg.start();
await pg.createDatabase("tql_news_test");
await pg.createDatabase("tql_news_preview_test");
mkdirSync(".data",{recursive:true});
const shared="COLLECT_ENABLED=false\nMODEL_CALLS_ENABLED=false\nFEISHU_CONTENT_PUSH_ENABLED=false\nINDEXNOW_SUBMIT_ENABLED=false\n";
for(const [file,db] of [["test.env","tql_news_test"],["preview.env","tql_news_preview_test"]]) {
  writeFileSync(`.data/${file}`,`DATABASE_URL=postgres://tql_test:${password}@127.0.0.1:15439/${db}\n${shared}`,{mode:0o600});
}
console.log("Local isolated PostgreSQL ready on 127.0.0.1:15439");
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await pg.stop();process.exit(0);}
process.on("SIGTERM",stop);process.on("SIGINT",stop);
setInterval(()=>{},60_000);

// Official X runs against a local provider stub; these tests never use a live token or external API.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { officialSearchParams, officialTweets, type XResponse } from "@aihot/backend/providers/x-official";
import { searchTweets } from "@aihot/backend/providers/socialdata";
import { BudgetExceededError, ProviderRejectedError, paidRequest } from "@aihot/backend/providers/receipts";
import { collectSource } from "@aihot/backend/sources/collect";

const T = tag();
const sourceId = `test-official-${T}`;
const id = String(BigInt(Date.now()) * 1000n);
const post = { id, text: "Short post", author_id: "42", created_at: new Date().toISOString(), lang: "en", note_tweet: { text: "Full long-post text https://t.co/link", entities: { urls: [{ url: "https://t.co/link", expanded_url: "https://example.org/news" }] } }, public_metrics: { like_count: 12 } };
const response: XResponse = { data: [post], includes: { users: [{ id: "42", name: "Football reporter", username: "TestFPL" }] }, meta: { next_token: "page-two" } };
let answer: unknown = response;
let lastParams: URLSearchParams;
const provider = await stub((_hit, req) => {
  const url = new URL(req.url, "http://stub");
  assert.equal(url.pathname, "/2/tweets/search/recent");
  lastParams = url.searchParams;
  return answer;
});
process.env.X_API_BASE_URL = provider.url;
process.env.X_BEARER_TOKEN = "test-token";
process.env.X_API_DAILY_BUDGET_USD = "5";
config.allowPrivateNetworkFetch = true;

let savedBudget: { per_minute: number; per_hour: number; per_day: number } | undefined;
before(async () => {
  [savedBudget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='x_api'`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='x_api'`;
  await sql`UPDATE settings SET value='{"enabled":true,"initialized":true}'::jsonb WHERE key='collection.x'`;
  await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,next_fetch_at) VALUES(${sourceId},'Test official X','x_search',${sql.json({ query: "from:TestFPL -filter:replies", _aihot: { initialBackfillLimit: 6 } })},'T1','editorial','2100-01-01')`;
});
after(async () => {
  if (savedBudget) await sql`UPDATE budgets SET per_minute=${savedBudget.per_minute},per_hour=${savedBudget.per_hour},per_day=${savedBudget.per_day} WHERE service='x_api'`;
  await sql`UPDATE settings SET value='{"enabled":false,"initialized":true}'::jsonb WHERE key='collection.x'`; await provider.close(); await stopBoss(); await closeDb(); });

test("saved queries translate reply filters and watermark without putting since_id in the query", () => {
  const params = officialSearchParams("(from:Arsenal OR from:ChelseaFC) -filter:replies since_id:123", { cursor: "next", type: "Latest" });
  assert.equal(params.get("query"), "(from:Arsenal OR from:ChelseaFC) -is:reply -is:retweet");
  assert.equal(params.get("since_id"), "123");
  assert.equal(params.get("next_token"), "next");
  assert.equal(params.get("max_results"), "10");
  assert.equal(params.get("sort_order"), "recency");
  assert.throws(() => officialSearchParams("from:Arsenal", { maxResults: 1000 }));
});

test("long text and author fields survive conversion; missing authors cannot produce wrong account links", () => {
  const [tweet] = officialTweets(response);
  assert.equal(tweet!.full_text, post.note_tweet.text);
  assert.equal(tweet!.user.screen_name, "TestFPL");
  assert.equal(tweet!.favorite_count, 12);
  assert.throws(() => officialTweets({ data: [post] }), /author/);
});

test("official API stores costs and pagination, and reuses the paid response on retry", async () => {
  const opts = { purpose: "test", subject: sourceId, window: T };
  const first = await searchTweets("from:TestFPL -filter:replies since_id:1", opts);
  const second = await searchTweets("from:TestFPL -filter:replies since_id:1", opts);
  assert.equal(provider.hits(), 1);
  assert.equal(first.nextCursor, "page-two");
  assert.equal(second.reused, true);
  assert.equal(lastParams!.get("since_id"), "1");
  assert.equal(lastParams!.get("expansions"), "author_id");
  const [receipt] = await sql`SELECT cost,usage,request FROM receipts WHERE id=${first.receiptId}`;
  assert.equal(Number(receipt!.cost), 0.015);
  assert.deepEqual(receipt!.usage, { tweets: 1, users: 1 });
  assert.ok(!JSON.stringify(receipt!.request).includes("test-token"));
});

test("official post reaches the existing material store with expanded links and a source watermark", async () => {
  const result = await collectSource(sourceId, { force: true });
  assert.equal(result.status, "ok");
  assert.equal(result.created, 1);
  const [material] = await sql`SELECT url,author,body_text,x_post FROM articles WHERE source_id=${sourceId}`;
  assert.equal(material!.url, `https://x.com/TestFPL/status/${id}`);
  assert.equal(material!.body_text, "Full long-post text https://example.org/news");
  const [source] = await sql`SELECT cursor FROM sources WHERE id=${sourceId}`;
  assert.equal(source!.cursor.lastTweetId, id);
});

test("exhausted X credits fail visibly without advancing the successful watermark", async () => {
  answer = new Reply(402, { title: "Payment Required", detail: "credits depleted" });
  const result = await collectSource(sourceId, { force: true });
  assert.equal(result.status, "failed");
  assert.match(result.error!, /402.*credits depleted/);
  const [source] = await sql`SELECT cursor FROM sources WHERE id=${sourceId}`;
  assert.equal(source!.cursor.lastTweetId, id);
  await assert.rejects(searchTweets("from:OtherAccount", { purpose: "rejection", subject: sourceId, window: T }), ProviderRejectedError);
  answer = response;
});

test("dollar limit rejects a request before it reaches the provider", async () => {
  const before = provider.hits();
  process.env.X_API_DAILY_BUDGET_USD = "0";
  try {
    await assert.rejects(searchTweets("from:NoCall", { purpose: "budget", subject: sourceId, window: T }), BudgetExceededError);
    assert.equal(provider.hits(), before);
  } finally { process.env.X_API_DAILY_BUDGET_USD = "5"; }
});

test("concurrent paid requests reserve budget before leaving the database transaction", async () => {
  const service = `expense-${T}`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sent = 0;
  const call = (identity: number) => paidRequest({ service, purpose: "expense", identity, expenseBudget: { dailyUsd: 0.2, maxRequestUsd: 0.15 } }, async () => { sent++; await gate; return { response: {}, cost: { amount: 0.15, currency: "USD", basis: "estimated" } }; });
  const first = call(1);
  while (!sent) await new Promise(resolve => setTimeout(resolve, 5));
  try { await assert.rejects(call(2), BudgetExceededError); assert.equal(sent, 1); }
  finally { release(); await first; }
});

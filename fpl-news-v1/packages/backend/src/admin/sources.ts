// Source administration (F18): list, detail, preview (fetch without storing), edit, create with
// duplicate checks, pause/resume and manual collection. Every change is audited.
import { createHash } from "node:crypto";
import { config, credential } from "../config.ts";
import { Bootstrap, FPL_SOURCE_URL } from "../fpl/data.ts";
import { mpHistory } from "../providers/dajiala.ts";
import { stripTags } from "../lib/text.ts";
import { prepareCandidates } from "../sources/prepare.ts";
import type { Candidate } from "../sources/types.ts";
import { z } from "zod";
import { sql } from "../db.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { republishKey } from "../jobs/publication.ts";
import { normalizeUrl } from "../lib/url.ts";
import { fetchJsonList } from "../sources/json-list.ts";
import { fetchRss } from "../sources/rss.ts";
import { assertSourceConfig } from "../sources/config-keys.ts";
import type { SourceRow } from "../sources/types.ts";
import { fetchWebList } from "../sources/web-list.ts";
import { fetchXSearch } from "../sources/x.ts";
import { assertXCollectionEnabled, xCollectionState } from "../sources/x-control.ts";
import { audit } from "./auth.ts";

export class Conflict extends Error {
  code = "conflict";
}

export interface SourceListFilters {
  q?: string;
  kind?: string;
  health?: string;
  enabled?: "true" | "false";
  mode?: string;
  page?: number;
}

export async function listSources(f: SourceListFilters) {
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const rows = await sql`
    SELECT s.id, s.name, s.kind, s.tier, s.participation_mode, s.enabled, s.health, s.fail_count, s.interval_minutes,
           s.last_ok_at, s.last_fetch_at, s.last_error, s.first_party, s.next_fetch_at,
           (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id AND a.discovered_at > now() - interval '7 days') AS items_7d,
           (SELECT count(*)::int FROM publications p WHERE p.source_id = s.id AND p.selected AND p.discovered_at > now() - interval '30 days') AS selected_30d
    FROM sources s
    WHERE (${q}::text IS NULL OR s.name ILIKE ${q} OR s.id ILIKE ${q} OR s.config::text ILIKE ${q})
      AND (${f.kind ?? null}::text IS NULL OR s.kind = ${f.kind ?? null})
      AND (${f.health ?? null}::text IS NULL OR s.health = ${f.health ?? null})
      AND (${f.mode ?? null}::text IS NULL OR s.participation_mode = ${f.mode ?? null})
      AND (${f.enabled ?? null}::text IS NULL OR s.enabled = (${f.enabled ?? null} = 'true'))
    ORDER BY s.enabled DESC, CASE s.health WHEN 'failing' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END, s.name
    LIMIT 100 OFFSET ${(page - 1) * 100}`;
  const [totals] = await sql<{ total: number; enabled: number; failing: number; degraded: number; issues: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE enabled)::int AS enabled,
           count(*) FILTER (WHERE health = 'failing')::int AS failing, count(*) FILTER (WHERE health = 'degraded')::int AS degraded, count(*) FILTER (WHERE enabled AND health <> 'ok' AND fail_count > 0)::int AS issues
    FROM sources`;
  return { page, rows, totals, runtime: await sourceRuntime() };
}

export async function sourceDetail(id: string) {
  const [source] = await sql`SELECT * FROM sources WHERE id = ${id}`;
  if (!source) return null;
  const runs = await sql`SELECT id, started_at, finished_at, status, found_count, new_count, error, detail FROM fetch_runs WHERE source_id = ${id} ORDER BY started_at DESC LIMIT 30`;
  const items = await sql`
    SELECT a.id, a.title, a.url, a.discovered_at, a.published_at, a.processing_state, a.author, a.language, left(a.excerpt, 4000) AS excerpt, left(a.body_text, 8000) AS body_text, a.body_status, jsonb_array_length(a.media) AS media_count, p.category, p.tags AS publication_tags, p.summary AS summary_zh, p.selected, p.visibility, p.title AS title_zh
    FROM articles a LEFT JOIN publications p ON p.article_id = a.id WHERE a.source_id = ${id} ORDER BY a.discovered_at DESC LIMIT 30`;
  const [stats] = await sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE a.discovered_at > now() - interval '7 days')::int AS last7d,
           (SELECT count(*)::int FROM publications p WHERE p.source_id = ${id} AND p.selected) AS selected
    FROM articles a WHERE a.source_id = ${id}`;
  const history = await sql`SELECT created_at, actor, action, reason, before, after FROM audit_log WHERE subject = ${`source:${id}`} ORDER BY created_at DESC LIMIT 20`;
  const [republish] = await sql<{ value: Record<string, unknown> }[]>`SELECT value FROM settings WHERE key = ${republishKey(id)}`;
  const tests = await sql<{id:number;created_at:Date;config_hash:string;result:Awaited<ReturnType<typeof previewSource>>}[]>`SELECT id, created_at, config_hash, result FROM source_tests WHERE source_id = ${id} ORDER BY created_at DESC LIMIT 10`;
  const jobs = await sql`SELECT id, state, created_on, started_on, completed_on, left(output::text, 500) AS output FROM pgboss.job WHERE name IN ('sources.fetch','sources.mp') AND data->>'sourceId' = ${id} ORDER BY created_on DESC LIMIT 5`;
  return { source, runs, items, stats, history, tests: tests.map(t => ({...t, matchesSavedConfig: t.config_hash === configHash(source.config)})), jobs, runtime: await sourceRuntime(), republish: republish?.value ?? null };
}

const PreviewSchema = z.object({
  id: z.string().min(1).max(80), kind: z.enum(["rss","web_list","json_list","x_search","mp_account","external"]),
  config: z.record(z.string(), z.unknown()),
});

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
export const configHash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export async function sourceRuntime() {
  const [worker] = await sql<{updated_at:Date}[]>`SELECT updated_at FROM settings WHERE key='heartbeat.worker'`;
  const xState = await xCollectionState();
  const xProvider = credential("collectors","X_BEARER_TOKEN") ? "x_api" : credential("collectors","SOCIALDATA_API_KEY") ? "socialdata" : null;
  const [xUsage] = await sql<{ usd: number; reserved: number; requests: number }[]>`
    SELECT coalesce(sum(a.cost) FILTER (WHERE a.currency='USD'),0)::float8 AS usd,
      coalesce(sum(coalesce((r.request->>'_maxCostUsd')::numeric,0)) FILTER (WHERE a.status IN ('pending','unknown')),0)::float8 AS reserved,
      count(*)::int AS requests
    FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
    WHERE a.service=${xProvider ?? 'x_api'} AND a.origin='live' AND a.started_at>now()-interval '1 day'`;
  const [xSources] = await sql<{ total: number; enabled: number; ok: number; failing: number }[]>`SELECT count(*)::int AS total,count(*) FILTER(WHERE enabled)::int AS enabled,count(*) FILTER(WHERE last_ok_at IS NOT NULL)::int AS ok,count(*) FILTER(WHERE enabled AND fail_count>0 AND health<>'ok')::int AS failing FROM sources WHERE kind='x_search'`;
  return {
    collectEnabled: process.env.COLLECT_ENABLED !== "false", modelEnabled: config.modelCallsEnabled,
    workerAlive: !!worker && Date.now()-worker.updated_at.getTime() < 180_000,
    workerAt: worker?.updated_at ?? null,
    xConfigured: !!(credential("collectors","X_BEARER_TOKEN") || credential("collectors","SOCIALDATA_API_KEY")),
    xProvider,
    xCollectionEnabled: xState.enabled, xCollectionInitialized: xState.initialized,
    xSources: xSources!, xUsage: xUsage!,
    xDailyBudgetUsd: xProvider === "x_api" ? Number(credential("collectors","X_API_DAILY_BUDGET_USD") ?? 5) : null,
    mpConfigured: !!credential("collectors","DAJIALA_KEY"),
    kinds: (process.env.COLLECT_KINDS || "rss,web_list,json_list,x_search").split(","),
  };
}

function providerReady(kind: string) {
  if (kind === "x_search" && !credential("collectors","X_BEARER_TOKEN") && !credential("collectors","SOCIALDATA_API_KEY")) throw new Error("X 需要在服务器配置 X_BEARER_TOKEN 与 x_api 预算（或 SocialData 密钥与预算）；当前未接入。");
  if (kind === "mp_account" && !credential("collectors","DAJIALA_KEY")) throw new Error("公众号需要在服务器配置 DAJIALA_KEY，并设置 dajiala 预算；当前未接入。");
}

/** Adapter/listing test only: no material, processing, price observation or model write. */
export async function previewSource(draft: Pick<SourceRow, "id" | "kind" | "config"> & Partial<SourceRow>) {
  PreviewSchema.parse(draft);
  assertSourceConfig(draft.kind, draft.config);
  const source = { name: draft.id, enabled: true, cursor: null, tier: "T2", participation_mode: "editorial", ...draft } as SourceRow;
  const started = Date.now();
  try {
    if (source.kind === "x_search") await assertXCollectionEnabled();
    providerReady(source.kind);
    let candidates: Candidate[];
    let priceData = false;
    if (source.kind === "rss") candidates = (await fetchRss(source, { force: true })).candidates;
    else if (source.kind === "web_list") candidates = await fetchWebList(source);
    else if (source.kind === "json_list") candidates = await fetchJsonList(source);
    else if (source.kind === "x_search") candidates = (await fetchXSearch(source)).candidates;
    else if (source.kind === "mp_account") {
      const found = await mpHistory(String(source.config.ghid), {subject:`source-test:${source.id}`, window:String(Math.floor(Date.now()/60_000))});
      candidates = found.posts.map(c=>({title:c.title,url:c.url,publishedAt:new Date(c.post_time*1000),excerpt:stripTags(c.digest??""),bodyStatus:"none"}));
    } else if (source.id === "fpl-official-prices") {
      const response = await fetch(FPL_SOURCE_URL,{signal:AbortSignal.timeout(25_000)});
      if (!response.ok) throw new Error(`FPL 官方接口 HTTP ${response.status}`);
      const data = Bootstrap.parse(await response.json());
      priceData = true;
      candidates = data.elements.map(p=>({title:`${p.web_name} · £${(p.now_cost/10).toFixed(1)}m`,url:FPL_SOURCE_URL,author:"FPL 官方",excerpt:`code=${p.code}；status=${p.status}；news=${p.news || '无伤停消息'}`,bodyStatus:"none"}));
    } else throw new Error("外部上报信源通过 Agent/API 接收数据，不支持主动抓取。请在 Agent 接入页查看方法。");
    const accepted = priceData ? candidates : prepareCandidates(candidates, source);
    const warnings: string[] = [];
    if (!priceData && !source.cursor?.initializedAt) warnings.push(`首次正式采集最多 ${source.config._aihot?.initialBackfillLimit ?? 30} 条，首次导入按原文时间归档。后续每轮最多 60 条（X 除外）。`);
    if (!priceData && accepted.some(c=>!c.publishedAt)) warnings.push("部分条目没有发布时间；系统不会虚构原文发布时间。");
    if (source.config.detail) warnings.push("本次测试显示列表提取结果。详情页的标题、日期和正文补充在正式采集时执行。");
    if (source.kind === "x_search" || source.kind === "mp_account" || String(source.config.url??"").startsWith("https://r.jina.ai/")) warnings.push("该提供商测试有请求费用，已使用现有回执和预算限制。");
    if (priceData) warnings.push("这是当前价格检查，不写入观测基线或涨跌记录；官方价格任务每 10 分钟自动运行。");
    return { status: accepted.length ? "ok" as const : "empty" as const, testedAt:new Date().toISOString(), ms:Date.now()-started,
      count:candidates.length, acceptedCount:accepted.length, configHash:configHash(source.config), warnings, error:null,
      items:accepted.slice(0,20).map(c=>({title:c.title,url:c.url,publishedAt:c.publishedAt && Number.isFinite(c.publishedAt.getTime())?c.publishedAt.toISOString():null,
        author:c.author??null,language:c.language??null,excerpt:(c.excerpt??"").slice(0,4000),bodyText:(c.bodyText??"").slice(0,8000),bodyStatus:c.bodyStatus??"pending",categories:c.categories??[],mediaCount:c.media?.length??0})) };
  } catch(error) {
    return {status:"failed" as const,testedAt:new Date().toISOString(),ms:Date.now()-started,count:0,acceptedCount:0,configHash:configHash(source.config),items:[],warnings:[],error:String(error instanceof Error?error.message:error).slice(0,500)};
  }
}

/** Saved-source tests retain their result; unsaved edits are clearly marked by their configuration hash. */
export async function testSource(id: string, input: { config?: unknown; version?: string }, actor: string) {
  const [saved] = await sql`SELECT * FROM sources WHERE id=${id}`;
  if (!saved) return null;
  if (input.config !== undefined && new Date(saved.updated_at).toISOString() !== input.version) throw new Conflict("信源已修改，请刷新后测试");
  const result = await previewSource({...saved, config: input.config === undefined ? saved.config : input.config} as never);
  await sql.begin(async tx=>{
    await tx`INSERT INTO source_tests(source_id,actor,config_hash,result) VALUES(${id},${actor},${result.configHash},${tx.json(result as never)})`;
    await tx`DELETE FROM source_tests WHERE source_id=${id} AND id NOT IN (SELECT id FROM source_tests WHERE source_id=${id} ORDER BY created_at DESC LIMIT 20)`;
  });
  await audit(actor,"source.test",`source:${id}`,null,null,{status:result.status,count:result.count,acceptedCount:result.acceptedCount});
  return {...result,matchesSavedConfig:result.configHash===configHash(saved.config)};
}

const EDITABLE = z
  .object({
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
    interval_minutes: z.number().int().min(1).max(1440),
    tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]),
    participation_mode: z.enum(["editorial", "hot_signal", "isolated"]),
    signal_group_id: z.string().max(120).nullable(),
    first_party: z.boolean(),
    owner_entity_id: z.string().max(120).nullable(),
    site_fulltext: z.boolean(),
    syndicate_fulltext: z.boolean(),
    tags: z.array(z.string().max(60)).max(30),
    config: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict();

export async function updateSource(id: string, input: { patch: unknown; version: string; reason?: string }, actor: string) {
  const patch = EDITABLE.parse(input.patch);
  return sql.begin(async (tx) => {
    const [before] = await tx`SELECT * FROM sources WHERE id = ${id} FOR UPDATE`;
    if (!before) return null;
    if (new Date(before.updated_at as Date).toISOString() !== input.version) throw new Conflict("信源已被其他操作修改，请刷新后再改");
    if (patch.config) assertSourceConfig(before.kind as SourceRow["kind"], patch.config);
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (!keys.length) return before;
    const values = Object.fromEntries(keys.map((k) => [k, k === "config" ? tx.json(patch.config as never) : patch[k]]));
    const [after] = await tx`UPDATE sources SET ${tx(values as never, ...(keys as string[]))}, updated_at = now(),
      health = CASE WHEN ${patch.enabled ?? null}::boolean IS FALSE THEN 'paused' WHEN ${patch.enabled ?? null}::boolean IS TRUE AND health = 'paused' THEN 'unknown' ELSE health END,
      next_fetch_at = CASE WHEN ${patch.enabled ?? null}::boolean IS TRUE THEN now() ELSE next_fetch_at END
      WHERE id = ${id} RETURNING *`;
    await audit(actor, "source.update", `source:${id}`, input.reason ?? null, Object.fromEntries(keys.map((k) => [k, before[k]])), patch);
    // What public exits show for this source's articles is derived from these fields: re-derive them
    // all (in the worker) so a revoked licence or an isolated source stops on every exit.
    if (keys.some((k) => PUBLICATION_FIELDS.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(patch[k]))) {
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${republishKey(id)}, ${tx.json({ status: "queued", queuedAt: new Date().toISOString() })}, ${actor})
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
      await enqueue(QUEUES.republishSource, { sourceId: id }, { singletonKey: id }, tx);
    }
    return after;
  });
}

/** Source fields the public projection reads (publication/rules.ts and the v1 payload). */
const PUBLICATION_FIELDS: string[] = ["participation_mode", "site_fulltext", "syndicate_fulltext", "tier", "name", "first_party"];

const CreateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    name: z.string().min(1).max(200),
    enabled: z.boolean().default(false),
    kind: z.enum(["rss", "web_list", "json_list", "x_search", "mp_account", "external"]),
    config: z.record(z.string(), z.unknown()),
    tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]).default("T2"),
    participation_mode: z.enum(["editorial", "hot_signal", "isolated"]).default("editorial"),
    interval_minutes: z.number().int().min(1).max(1440).default(30),
    first_party: z.boolean().default(false),
    tags: z.array(z.string().max(60)).max(30).default([]),
    site_fulltext: z.boolean().default(false),
    syndicate_fulltext: z.boolean().default(false),
  })
  .strict();

/** The address a source collects from, used to find duplicates before creating one. */
export function sourceIdentity(kind: string, config: Record<string, unknown>): string | null {
  const raw = (config.feedUrl ?? config.url ?? config.listUrl ?? config.endpoint ?? null) as string | null;
  if (kind === "x_search") {
    const m = /from:([A-Za-z0-9_]{1,15})/.exec(String(config.query ?? ""));
    return m ? `x:${m[1]!.toLowerCase()}` : null;
  }
  if (!raw) return null;
  try {
    return normalizeUrl(String(raw).replace(/^https:\/\/r\.jina\.ai\//, "")) ?? String(raw);
  } catch {
    return String(raw);
  }
}

export async function findDuplicateSource(kind: string, config: Record<string, unknown>) {
  const identity = sourceIdentity(kind, config);
  if (!identity) return null;
  const rows = await sql<{ id: string; kind: string; config: Record<string, unknown>; name: string }[]>`SELECT id, kind, config, name FROM sources WHERE kind = ${kind}`;
  return rows.find((r) => sourceIdentity(r.kind, r.config) === identity) ?? null;
}

export async function createSource(input: unknown, actor: string) {
  const s = CreateSchema.parse(input);
  assertSourceConfig(s.kind, s.config);
  const dup = await findDuplicateSource(s.kind, s.config);
  if (dup) return { created: false as const, duplicate: dup };
  const [row] = await sql`
    INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, first_party, tags, site_fulltext, syndicate_fulltext, enabled, health, next_fetch_at)
    VALUES (${s.id}, ${s.name}, ${s.kind}, ${sql.json(s.config as never)}, ${s.tier}, ${s.participation_mode}, ${s.interval_minutes}, ${s.first_party}, ${s.tags},
            ${s.site_fulltext}, ${s.syndicate_fulltext}, ${s.enabled}, ${s.enabled ? "unknown" : "paused"}, now())
    ON CONFLICT (id) DO NOTHING RETURNING *`;
  if (!row) throw new Conflict(`信源 ID ${s.id} 已存在`);
  await audit(actor, "source.create", `source:${s.id}`, null, null, s);
  return { created: true as const, source: row };
}

export async function fetchNow(id: string, actor: string) {
  const [s] = await sql<{ id: string; kind: string }[]>`SELECT id, kind FROM sources WHERE id = ${id}`;
  if (!s) return null;
  const runtime = await sourceRuntime();
  const reject = (message: string): never => {throw Object.assign(new Error(message),{statusCode:400});};
  if (s.kind === "x_search") await assertXCollectionEnabled();
  if (!runtime.collectEnabled) reject("服务器采集开关已关闭，请先开启 COLLECT_ENABLED。");
  if (!runtime.workerAlive) reject("采集进程未在线，请在运行记录检查 worker；未提交任务。");
  if (s.kind === "external") reject(s.id === "fpl-official-prices" ? "官方价格由独立任务每 10 分钟检查，请使用测试按钮检查接口。" : "外部上报通过 API 接收数据，不能主动采集。");
  try { providerReady(s.kind); } catch(error) { reject((error as Error).message); }
  const jobId =
    s.kind === "mp_account"
      ? await enqueue(QUEUES.mpCheck, { sourceId: id, reason: "manual" }, { singletonKey: `mp:${id}` })
      : await enqueue(QUEUES.fetchSource, { sourceId: id, force: true }, { singletonKey: `manual:${id}` });
  await audit(actor, "source.fetch", `source:${id}`, null, null, { jobId });
  return { jobId, status: jobId ? "queued" : "already-queued", message: jobId ? "任务已入队，稍后在采集记录和提取数据中查看结果。" : "同一信源已有采集任务，请等待完成。" };
}

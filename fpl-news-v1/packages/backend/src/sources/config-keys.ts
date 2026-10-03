// The config keys each kind of source implements. Anything else is refused: a key a collector does not
// know would otherwise fall back silently to the generic parse (menus and sentence fragments as
// articles, dates never found).
import type { SourceRow } from "./types.ts";

// Rules applied in collect.ts to every kind read through collectSource.
const COLLECTED = ["_aihot", "allowUrlPrefixes", "denyUrlPrefixes", "ingestNoiseFilter", "itemUrlPrefixRewrite", "sortByPublishedAt", "detail", "fetchPublicContent"];

const KEYS: Record<SourceRow["kind"], string[]> = {
  rss: [...COLLECTED, "feedUrl", "summaryIsBody", "preserveUrlFragment", "allowCategories", "denyCategories"],
  web_list: [
    ...COLLECTED, "url", "baseUrl", "parseMode", "adapter", "cacheToleranceSeconds", "linksStartLine", "preserveUrlFragment",
    "itemSelector", "linkSelector", "titleSelector", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset",
  ],
  json_list: [
    ...COLLECTED, "url", "mode", "method", "headers", "bodyJson", "jsonKey", "windowVar", "itemsPath", "itemsObjectValues",
    "titlePaths", "summaryPaths", "summaryIsBody", "authorPaths", "publishedAtPath", "publishedAtUnit", "externalIdPath",
    "urlTemplate", "urlTemplateFallback", "rawDropKeys", "requireBoolean", "minNumeric",
  ],
  // X accounts are mostly read in shards, which apply only these.
  x_search: ["_aihot", "ingestNoiseFilter", "itemUrlPrefixRewrite", "query", "searchType"],
  mp_account: ["wxid", "ghid", "nickname"],
  external: [],
};

// Objects with fixed keys (headers and bodyJson are request data, free-form).
const NESTED: Record<string, string[]> = {
  _aihot: ["initialBackfillLimit", "initialBackfillMonths"],
  ingestNoiseFilter: ["dropMarkers", "dropMarkersTitleOnly", "keepIfMatches"],
  itemUrlPrefixRewrite: ["from", "to"],
  requireBoolean: ["path", "equals"],
  minNumeric: ["path", "min"],
  detail: [
    "maxFetches", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset", "publishedAtAuthoritative", "upgradeDatePrecision",
    "titleSelector", "titleRegex", "titleAuthoritative", "summarySelector",
  ],
};

const VALUES: Record<string, string[]> = {
  adapter: ["mimo_home"],
  parseMode: ["html", "markdown", "docusaurus_changelog"],
};

/** The config entries a source of this kind would ignore or cannot run, e.g. ["adapter=site_cards", "detail.titleFoo"]. */
export function unsupportedConfig(kind: SourceRow["kind"], config: Record<string, unknown>): string[] {
  const allowed = new Set(KEYS[kind] ?? []);
  const out: string[] = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!allowed.has(key)) out.push(key);
    else if (VALUES[key] && !VALUES[key]!.includes(String(value))) out.push(`${key}=${String(value)}`);
    else if (NESTED[key] && value && typeof value === "object") {
      for (const sub of Object.keys(value)) if (!NESTED[key]!.includes(sub)) out.push(`${key}.${sub}`);
    }
  }
  return out;
}

export class UnsupportedConfig extends Error {
  readonly statusCode = 400;
}

/** Refuses a config with entries its kind does not implement (admin create, edit and preview). */
export function assertSupportedConfig(kind: SourceRow["kind"], config: Record<string, unknown>): void {
  const bad = unsupportedConfig(kind, config);
  if (bad.length) throw new UnsupportedConfig(`不支持的配置项：${bad.join("、")}`);
}

/** Admin additions must contain the fields the adapter needs; unknown keys are never ignored. */
export function assertSourceConfig(kind: SourceRow["kind"], config: Record<string, unknown>): void {
  assertSupportedConfig(kind, config);
  const fail = (text: string): never => { throw new UnsupportedConfig(text); };
  if (["rss", "web_list", "json_list"].includes(kind)) {
    const field = kind === "rss" ? "feedUrl" : "url";
    try {
      const url = new URL(String(config[field] ?? ""));
      if (!["https:", "http:"].includes(url.protocol)) fail("信源地址必须是 http:// 或 https:// 地址");
    } catch { fail(`${field} 需要有效的 http:// 或 https:// 地址`); }
  }
  if (kind === "x_search" && !String(config.query ?? "").trim()) fail("X 信源需要 query，例如 from:OfficialFPL -filter:replies");
  if (kind === "mp_account" && !String(config.ghid ?? "").trim()) fail("公众号信源需要 ghid，例如 gh_xxxxxxxxxxxx");
  for (const key of ["allowUrlPrefixes","denyUrlPrefixes","allowCategories","denyCategories","titlePaths","summaryPaths","authorPaths","rawDropKeys"]) {
    const value=config[key];
    if (value!==undefined && (!Array.isArray(value) || value.some(v=>typeof v!=="string") || value.length>100)) fail(`${key} 必须是字符串数组，最多 100 项`);
  }
  const detail = config.detail as Record<string, unknown> | undefined;
  if (detail?.maxFetches !== undefined && (!Number.isInteger(detail.maxFetches) || Number(detail.maxFetches)<0 || Number(detail.maxFetches)>10)) fail("detail.maxFetches 必须是 0 到 10 的整数");
  for (const key of ["_aihot","detail","ingestNoiseFilter","itemUrlPrefixRewrite","headers","bodyJson"]) {
    const value=config[key];
    if(value!==undefined && (!value || typeof value!=="object" || Array.isArray(value))) fail(`${key} 必须是 JSON 对象`);
  }
  const initial = config._aihot as Record<string, unknown> | undefined;
  for (const [key, max] of [["initialBackfillLimit",60], ["initialBackfillMonths",24]] as const) {
    if (initial?.[key] !== undefined && (!Number.isInteger(initial[key]) || Number(initial[key]) < 1 || Number(initial[key]) > max)) fail(`${key} 必须是 1 到 ${max} 的整数`);
  }
}

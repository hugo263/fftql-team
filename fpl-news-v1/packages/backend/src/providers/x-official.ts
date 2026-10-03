// Official X API v2. Keep the existing post shape so collection and publication share one pipeline.
import { credential } from "../config.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { socksFetch } from "../lib/socks-fetch.ts";
import { paidRequest, ProviderRejectedError } from "./receipts.ts";
import type { SdTweet, SearchResult } from "./socialdata.ts";

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  lang?: string;
  note_tweet?: { text: string; entities?: SdTweet["entities"] };
  entities?: SdTweet["entities"];
  referenced_tweets?: Array<{ type: string; id: string }>;
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number; impression_count?: number };
}
export interface XResponse {
  data?: XTweet[] | XTweet;
  includes?: { users?: Array<{ id: string; name: string; username: string; profile_image_url?: string }> };
  meta?: { next_token?: string };
  errors?: unknown[];
}

/** Translate saved SocialData queries without changing their source configuration or watermark. */
export function officialSearchParams(query: string, opts: { type?: "Latest" | "Top"; cursor?: string | null; maxResults?: number } = {}) {
  const since = /(?:^|\s)since_id:(\d+)(?=\s|$)/.exec(query);
  const translated = query.replace(/(?:^|\s)since_id:\d+(?=\s|$)/g, " ").replace(/-filter:replies\b/gi, "-is:reply").trim();
  const maxResults = opts.maxResults ?? 10;
  if (!Number.isInteger(maxResults) || maxResults < 10 || maxResults > 100) throw new Error("X_API_MAX_RESULTS must be an integer between 10 and 100");
  const params = new URLSearchParams({ query: `${translated}${/-is:retweet\b/i.test(translated) ? "" : " -is:retweet"}`, max_results: String(maxResults), sort_order: opts.type === "Top" ? "relevancy" : "recency" });
  if (since) params.set("since_id", since[1]!);
  if (opts.cursor) params.set("next_token", opts.cursor);
  return params;
}

/** Author expansion is necessary for account shards; media and quoted-post expansions are omitted to bound costs. */
function fields(params: URLSearchParams) {
  params.set("tweet.fields", "author_id,created_at,entities,lang,public_metrics,referenced_tweets,note_tweet");
  params.set("expansions", "author_id");
  params.set("user.fields", "name,username,profile_image_url");
  return params;
}

export function officialTweets(json: XResponse): SdTweet[] {
  const users = new Map((json.includes?.users ?? []).map(user => [user.id, user]));
  const posts = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
  return posts.filter(post => !post.referenced_tweets?.some(ref => ref.type === "retweeted")).map(post => {
    const user = users.get(post.author_id);
    if (!user?.username || !/^\d+$/.test(post.id) || !Number.isFinite(Date.parse(post.created_at))) throw new Error("X API response is missing a valid post or author");
    return {
      id_str: post.id, tweet_created_at: post.created_at, full_text: post.note_tweet?.text ?? post.text, lang: post.lang,
      user: { name: user.name, screen_name: user.username, profile_image_url_https: user.profile_image_url },
      entities: post.note_tweet?.entities ?? post.entities,
      in_reply_to_status_id_str: post.referenced_tweets?.find(ref => ref.type === "replied_to")?.id ?? null,
      favorite_count: post.public_metrics?.like_count, retweet_count: post.public_metrics?.retweet_count,
      reply_count: post.public_metrics?.reply_count, quote_count: post.public_metrics?.quote_count, views_count: post.public_metrics?.impression_count,
    };
  });
}

async function request(path: string, params: URLSearchParams, opts: { purpose: string; subject: string; window?: string }) {
  const token = credential("collectors", "X_BEARER_TOKEN");
  if (!token) throw new Error("X_BEARER_TOKEN is not configured");
  // A separate base is useful for local provider stubs and operator-controlled gateways.
  const base = (credential("collectors", "X_API_BASE_URL") ?? "https://api.x.com").replace(/\/$/, "");
  const maxPosts = Number(params.get("max_results") ?? 1);
  const receipt = await paidRequest(
    { service: "x_api", purpose: opts.purpose, subject: opts.subject, identity: { base, path, params: params.toString(), window: opts.window ?? null }, requestSummary: { path, ...Object.fromEntries(params) }, expenseBudget: { dailyUsd: Number(credential("collectors", "X_API_DAILY_BUDGET_USD") ?? 5), maxRequestUsd: maxPosts * 0.015 } },
    async () => {
      const url = `${base}${path}?${params}`;
      const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
      const proxy = credential("collectors", "X_EGRESS_PROXY_URL");
      const res = proxy
        ? await socksFetch(url, proxy, { headers, timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 })
        : await guardedFetch(url, { headers, maxRedirects: 0, timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024, route: "egress" });
      if (res.status !== 200) {
        const detail = res.text().replaceAll(token, "[REDACTED]").replaceAll(decodeURIComponent(token), "[REDACTED]").slice(0, 300);
        throw new ProviderRejectedError(`X API HTTP ${res.status}: ${detail}`, res.status, res.status === 429 || res.status >= 500);
      }
      const json = JSON.parse(res.text()) as XResponse;
      if (json.errors?.length && !json.data) throw new Error("X API returned errors without post data");
      // Validate before a malformed response can be mistaken for an empty successful collection.
      officialTweets(json);
      const posts = Array.isArray(json.data) ? json.data.length : json.data ? 1 : 0;
      const users = json.includes?.users?.length ?? 0;
      return { response: json, usage: { tweets: posts, users }, cost: { amount: posts * 0.005 + users * 0.01, currency: "USD", basis: "estimated" as const } };
    },
  );
  return receipt;
}

export async function searchOfficialTweets(query: string, opts: { purpose: string; subject: string; window: string; type?: "Latest" | "Top"; cursor?: string | null }): Promise<SearchResult> {
  const maxResults = Number(credential("collectors", "X_API_MAX_RESULTS") ?? 10);
  const receipt = await request("/2/tweets/search/recent", fields(officialSearchParams(query, { ...opts, maxResults })), opts);
  const json = receipt.response as XResponse;
  return { tweets: officialTweets(json), nextCursor: json.meta?.next_token ?? null, receiptId: receipt.receiptId, reused: receipt.reused };
}

export async function getOfficialTweet(id: string, opts: { purpose: string; subject: string }): Promise<SdTweet | null> {
  const receipt = await request(`/2/tweets/${encodeURIComponent(id)}`, fields(new URLSearchParams()), opts);
  return officialTweets(receipt.response as XResponse)[0] ?? null;
}

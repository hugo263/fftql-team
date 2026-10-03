// Outbound HTTP for collectors, the image proxy and the paid APIs: SSRF guard, routing, limits.
import net from "node:net";
import { addAbortListener } from "node:events";
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { config } from "../config.ts";
import { assertPublicUrl, guardedLookup } from "./url.ts";
import { SITE } from "@aihot/industry/site";
import { withNetworkRetry } from "./network-retry.ts";

/**
 * Where a request leaves the host. "egress" (collection, bodies, images and leaderboard data) goes
 * through the egress proxy when EGRESS_PROXY_URL is set (for example a rule-based proxy that connects
 * .cn and .local names and Chinese or private addresses directly and sends the rest abroad); the names
 * and address literals such a proxy would connect directly are connected here instead, so the
 * connect-time address check still applies. "direct" is for paid APIs called straight (SocialData,
 * Dajiala) and the site's own addresses.
 */
export type EgressRoute = "egress" | "direct";

let proxyAgent: ProxyAgent | null = null;
let directAgent: Agent | null = null;
let ipv4Agent: Agent | null = null;

function proxied(url: URL, route: EgressRoute): boolean {
  if (route !== "egress" || !config.egressProxyUrl) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return net.isIP(host) === 0 && !host.endsWith(".cn") && !host.endsWith(".local");
}

function dispatcherFor(viaProxy: boolean, ipv4Fallback = false): Dispatcher | undefined {
  if (viaProxy) {
    proxyAgent ??= new ProxyAgent(config.egressProxyUrl!);
    return proxyAgent;
  }
  if (config.allowPrivateNetworkFetch) return undefined;
  if (ipv4Fallback) {
    // Retain connect-time SSRF checks; never bypass a configured proxy on a retry.
    ipv4Agent ??= new Agent({ connect: { lookup: guardedLookup as never, family: 4, timeout: 30_000 } });
    return ipv4Agent;
  }
  // Direct connections resolve through the guarded lookup: the address actually dialled is checked.
  // Some overseas feeds complete TLS slowly from the mainland host. The overall request
  // signal below still bounds faster callers; do not let Undici's 10 s default cut RSS short.
  directAgent ??= new Agent({ connect: { lookup: guardedLookup as never, timeout: 30_000 } });
  return directAgent;
}

export interface GuardedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Follow redirects manually so every hop passes the SSRF guard. */
  maxRedirects?: number;
  /** "egress" by default; see EgressRoute. */
  route?: EgressRoute;
  /** RSS opts in: retry one transient GET/HEAD failure; direct DNS hosts fall back to IPv4. */
  retryNetworkErrors?: boolean;
}

export interface GuardedResponse {
  status: number;
  url: string;
  headers: Headers;
  body: Buffer;
  text(): string;
}

/** How the collectors introduce themselves: the site's own crawler name and address (industry/site.ts). */
export const DEFAULT_UA = `Mozilla/5.0 (compatible; ${SITE.crawlerName}/1.0; +${config.siteUrl}/about)`;

export async function guardedFetch(input: string, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  // One budget includes DNS, every redirect and the body. Restarting it at each hop allowed a
  // nominal 20 s image request to occupy the API for minutes.
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const route = opts.route ?? "egress";
  const check = (target: string) => withinDeadline(
    assertPublicUrl(target, config.allowPrivateNetworkFetch, proxied(new URL(target), route)), signal,
  );
  const retryEnabled = opts.retryNetworkErrors === true && !opts.body && /^(GET|HEAD)$/i.test(opts.method ?? "GET");
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  return withNetworkRetry(async retry => {
    let url = await check(input); // Recheck DNS and every redirect on retry as well.
    for (let hop = 0; ; hop++) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const res = await undiciFetch(url, {
        method: opts.method ?? "GET",
        headers: { "user-agent": DEFAULT_UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", ...(opts.headers ?? {}) },
        body: opts.body,
        redirect: "manual",
        dispatcher: dispatcherFor(proxied(url, route), retry && net.isIP(host) === 0),
        signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        if (hop >= maxRedirects) throw new Error(`Too many redirects for ${input}`);
        url = await check(new URL(res.headers.get("location")!, url).toString());
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > maxBytes) throw new Error(`Response too large from ${url.hostname}`);
          chunks.push(Buffer.from(chunk));
        }
      }
      const body = Buffer.concat(chunks);
      return {
        status: res.status, url: url.toString(), headers: res.headers as unknown as Headers, body,
        text: () => decodeBody(body, res.headers.get("content-type")),
      };
    }
  }, signal, retryEnabled);
}

/** DNS lookup cannot be cancelled, but a timed-out lookup must never continue into a fetch. */
async function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      subscription = addAbortListener(signal, () => reject(signal.reason));
    })]);
  } finally {
    subscription?.[Symbol.dispose]();
  }
}

function decodeBody(body: Buffer, contentType: string | null): string {
  const m = /charset=([\w-]+)/i.exec(contentType ?? "");
  let charset = m?.[1]?.toLowerCase() ?? "utf-8";
  if (!m) {
    const head = body.subarray(0, 2048).toString("latin1");
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ?? /encoding=["']([\w-]+)["']/i.exec(head);
    if (meta) charset = meta[1]!.toLowerCase();
  }
  let text: string;
  try {
    text = new TextDecoder(charset === "gb2312" ? "gbk" : charset).decode(body);
  } catch {
    text = body.toString("utf8");
  }
  // A character lost on the way reads as one U+FFFD however many of its bytes were garbled (some
  // feeds send two or three for one character), so text cut to a length keeps the same cut.
  return text.replace(/\uFFFD+/g, "\uFFFD");
}

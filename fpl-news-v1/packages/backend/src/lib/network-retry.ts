import { setTimeout as delay } from "node:timers/promises";

const transientCodes = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);
const labels: Record<string, string> = {
  ETIMEDOUT: "连接超时", ECONNRESET: "连接被重置", ECONNREFUSED: "连接被拒绝",
  EAI_AGAIN: "DNS 暂时不可用", ENETUNREACH: "网络不可达", EHOSTUNREACH: "目标不可达", EPIPE: "连接中断",
  UND_ERR_CONNECT_TIMEOUT: "连接超时", UND_ERR_SOCKET: "连接中断",
  UND_ERR_HEADERS_TIMEOUT: "等待响应头超时", UND_ERR_BODY_TIMEOUT: "读取内容超时",
};

/** Inspect codes, never nested messages (which may contain credentials). Bound cycles and size. */
export function networkErrorCodes(error: unknown): string[] {
  const codes = new Set<string>(), seen = new Set<object>(), pending: unknown[] = [error];
  while (pending.length && seen.size < 16) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const e = value as { code?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof e.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(e.code)) codes.add(e.code);
    if (e.cause) pending.push(e.cause);
    if (Array.isArray(e.errors)) pending.push(...e.errors.slice(0, 16));
  }
  return [...codes];
}

export function describeNetworkError(error: unknown): string {
  // Root URLs lose credentials, queries and fragments. Do not serialize request/header objects.
  const message = String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try { const u = new URL(raw); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return "[URL]"; }
    })
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(password|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\r\n]+/g, " ").slice(0, 650);
  const codes = networkErrorCodes(error);
  const reasons = codes.map(code => `${labels[code] ?? "网络错误"} (${code})`).join("；");
  return `${message}${reasons ? `；${reasons}` : ""}`.slice(0, 1000);
}

/** One opt-in retry, with the original deadline covering both attempts and the short backoff. */
export async function withNetworkRetry<T>(run: (retry: boolean) => Promise<T>, signal: AbortSignal, enabled: boolean): Promise<T> {
  if (!enabled) return run(false);
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await run(attempt > 0); }
    catch (error) {
      signal.throwIfAborted();
      const codes = networkErrorCodes(error);
      // Unknown, TLS certificate and SSRF failures are not transient, even inside an aggregate.
      if (attempt > 0 || codes.length === 0 || !codes.every(code => transientCodes.has(code))) {
        throw new Error(`${attempt ? "网络请求失败（已重试 1 次）：" : ""}${describeNetworkError(error)}`, { cause: error });
      }
      await delay(300, undefined, { signal });
    }
  }
}

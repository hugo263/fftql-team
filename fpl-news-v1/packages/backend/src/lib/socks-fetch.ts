// X's dedicated SOCKS5 transport. The server's Node TLS path resets intermittently on X;
// curl works with the same proxy and normal certificate validation.
import { spawn } from "node:child_process";
import { config } from "../config.ts";
import { assertPublicUrl } from "./url.ts";
import type { GuardedResponse } from "./http-fetch.ts";

function quoted(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid multiline HTTP option");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function socksFetch(input: string, proxyUrl: string, opts: {
  headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number;
} = {}): Promise<GuardedResponse> {
  const proxy = new URL(proxyUrl);
  if (!["socks5:", "socks5h:"].includes(proxy.protocol)) throw new Error("X proxy must use socks5:// or socks5h://");
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const signal = AbortSignal.timeout(timeoutMs);
  const url = await Promise.race([
    assertPublicUrl(input, config.allowPrivateNetworkFetch, true),
    new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  ]);
  signal.throwIfAborted();
  if (url.protocol !== "https:") throw new Error("X SOCKS transport requires HTTPS");
  proxy.protocol = "socks5h:";
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  const request = [
    `url = ${quoted(url.toString())}`, `proxy = ${quoted(proxy.toString())}`, 'noproxy = ""',
    ...Object.entries(opts.headers ?? {}).map(([name, value]) => {
      if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error("Invalid HTTP header name");
      return `header = ${quoted(`${name}: ${value}`)}`;
    }),
  ].join("\n") + "\n";

  return new Promise((resolve, reject) => {
    // Secrets only go to stdin. Disable curlrc, keep TLS verification, never follow redirects.
    const child = spawn("curl", ["--disable", "--config", "-", "--silent", "--show-error", "--compressed",
      "--connect-timeout", "10", "--max-time", String(timeoutMs / 1000),
      "--max-filesize", String(maxBytes), "--dump-header", "-", "--output", "-"],
    { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0, stderr = "", failure: Error | null = null;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const aborted = () => stop(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    child.stdout!.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes + 65536) stop(new Error("X API response too large"));
      else chunks.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(0, 2000); });
    child.stdin!.on("error", () => {});
    child.on("error", error => { failure ??= error; });
    child.on("close", code => {
      signal.removeEventListener("abort", aborted);
      if (failure) return reject(failure);
      if (code !== 0) {
        for (const secret of [decodeURIComponent(proxy.username), decodeURIComponent(proxy.password), ...Object.values(opts.headers ?? {})]) {
          if (secret) stderr = stderr.replaceAll(secret, "[REDACTED]");
        }
        return reject(new Error(`X SOCKS transport failed (curl ${code}): ${stderr.trim()}`));
      }
      try {
        const data = Buffer.concat(chunks);
        let offset = 0, status = 0, headers = new Headers();
        do {
          const end = data.indexOf("\r\n\r\n", offset);
          if (end < 0 || end > 65536) throw new Error("Invalid or oversized X API headers");
          const [statusLine, ...lines] = data.subarray(offset, end).toString("latin1").split("\r\n");
          const match = /^HTTP\/\S+\s+(\d{3})/.exec(statusLine!);
          if (!match) throw new Error("X SOCKS transport returned no HTTP status");
          status = Number(match[1]);
          headers = new Headers();
          for (const line of lines) {
            const colon = line.indexOf(":");
            if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
          }
          offset = end + 4;
        } while (status >= 100 && status < 200);
        const body = data.subarray(offset);
        if (body.length > maxBytes) throw new Error("X API response too large");
        resolve({ status, url: url.toString(), headers, body, text: () => body.toString("utf8") });
      } catch (error) { reject(error); }
    });
    child.stdin!.end(request);
    if (signal.aborted) aborted();
  });
}

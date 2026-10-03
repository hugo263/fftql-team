// Real local TLS + SOCKS fixtures; no external requests, production credentials or database.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer as httpsServer } from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { socksFetch } from "@aihot/backend/lib/socks-fetch";

const dir = mkdtempSync(path.join(tmpdir(), "tql-socks-test-"));
const cert = path.join(dir, "cert.pem"), key = path.join(dir, "key.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-keyout", key, "-out", cert, "-subj", "/CN=fixture.test", "-addext", "subjectAltName=DNS:fixture.test"], { stdio: "ignore" });
const savedCa = process.env.CURL_CA_BUNDLE;
const savedGuard = config.allowPrivateNetworkFetch;
const sockets = new Set<net.Socket>();
const destinations: string[] = [];
let originPort = 0, proxyPort = 0, requestAuth: string | undefined;
const origin = httpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  requestAuth = req.headers.authorization;
  assert.equal(req.headers["proxy-authorization"], undefined);
  if (req.url === "/redirect") { res.writeHead(302, { location: "https://127.0.0.1:1/" }); res.end(); }
  else if (req.url === "/large") { res.writeHead(200); res.end("x".repeat(100000)); }
  else if (req.url === "/slow") { /* stay open until the client's deadline kills curl */ }
  else { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); }
});
const proxy = net.createServer(socket => {
  sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
  let data = Buffer.alloc(0), state = "greeting";
  const received = (chunk: Buffer) => {
    data = Buffer.concat([data, chunk]);
    if (state === "greeting" && data.length >= 2 + data[1]!) {
      data = data.subarray(2 + data[1]!); socket.write(Buffer.from([5, 2])); state = "auth";
    }
    if (state === "auth" && data.length >= 2 + data[1]! + 1) {
      const userEnd = 2 + data[1]!, end = userEnd + 1 + data[userEnd]!;
      if (data.length < end) return;
      assert.equal(data.subarray(2, userEnd).toString(), "fixture-user");
      assert.equal(data.subarray(userEnd + 1, end).toString(), "fixture-pass");
      data = data.subarray(end); socket.write(Buffer.from([1, 0])); state = "connect";
    }
    if (state === "connect" && data.length >= 7) {
      assert.equal(data[3], 3, "target hostname must be resolved by SOCKS, not locally");
      const end = 5 + data[4]! + 2;
      if (data.length < end) return;
      destinations.push(data.subarray(5, end - 2).toString());
      assert.equal(data.readUInt16BE(end - 2), originPort);
      const pending = data.subarray(end);
      socket.removeListener("data", received); state = "connected";
      const target = net.connect(originPort, "127.0.0.1", () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        if (pending.length) target.write(pending);
        socket.pipe(target); target.pipe(socket);
      });
      sockets.add(target); target.on("close", () => sockets.delete(target));
      target.on("error", () => socket.destroy()); socket.on("close", () => target.destroy());
    }
  };
  socket.on("data", received);
});
const target = (suffix: string) => `https://fixture.test:${originPort}${suffix}`;
const proxyUrl = () => `socks5://fixture-user:fixture-pass@127.0.0.1:${proxyPort}`;

before(async () => {
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));
  originPort = (origin.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  proxyPort = (proxy.address() as net.AddressInfo).port;
  config.allowPrivateNetworkFetch = true;
  process.env.CURL_CA_BUNDLE = cert;
});
after(async () => {
  for (const socket of sockets) socket.destroy();
  origin.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => origin.close(() => resolve())), new Promise<void>(resolve => proxy.close(() => resolve()))]);
  config.allowPrivateNetworkFetch = savedGuard;
  if (savedCa === undefined) delete process.env.CURL_CA_BUNDLE; else process.env.CURL_CA_BUNDLE = savedCa;
  rmSync(dir, { recursive: true, force: true });
});

test("SOCKS remote DNS, verified TLS and API authorization reach the existing response shape", async () => {
  const res = await socksFetch(target("/ok"), proxyUrl(), { headers: { authorization: "Bearer fixture-key" } });
  assert.equal(res.status, 200); assert.deepEqual(JSON.parse(res.text()), { ok: true });
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(requestAuth, "Bearer fixture-key"); assert.equal(destinations.at(-1), "fixture.test");
});
test("redirects are returned without fetching an unchecked destination", async () => {
  const res = await socksFetch(target("/redirect"), proxyUrl());
  assert.equal(res.status, 302); assert.equal(res.headers.get("location"), "https://127.0.0.1:1/");
});
test("unknown certificates remain refused", async () => {
  delete process.env.CURL_CA_BUNDLE;
  try { await assert.rejects(socksFetch(target("/ok"), proxyUrl()), /curl 60|certificate/i); }
  finally { process.env.CURL_CA_BUNDLE = cert; }
});
test("response limits and deadlines terminate the subprocess", async () => {
  await assert.rejects(socksFetch(target("/large"), proxyUrl(), { maxBytes: 1024 }), /too large|curl 63|exceeds/i);
  const start = Date.now();
  await assert.rejects(socksFetch(target("/slow"), proxyUrl(), { timeoutMs: 250 }));
  assert.ok(Date.now() - start < 2000);
});
test("public-address checks and config injection checks run before sending credentials", async () => {
  config.allowPrivateNetworkFetch = false;
  try { await assert.rejects(socksFetch("https://127.0.0.1/", proxyUrl()), /private address/); }
  finally { config.allowPrivateNetworkFetch = true; }
  await assert.rejects(socksFetch(target("/ok"), proxyUrl(), { headers: { authorization: 'Bearer key\n insecure' } }), /multiline/);
});

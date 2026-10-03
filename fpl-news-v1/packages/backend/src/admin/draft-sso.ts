import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "../db.ts";
import { createSession, LoginRejected } from "./auth.ts";

const ISSUER = "https://fftql.team";
const AUDIENCE = "https://news.fftql.team";
const MAX_SESSION_MS = 7 * 86400_000;
export const draftSsoConfigured = () => (process.env.TQL_ADMIN_SSO_SECRET?.length ?? 0) >= 32;

export interface DraftTicket {
  iss: string; aud: string; sub: string; iat: number; exp: number; sessionExp: number; jti: string;
}

/** Fixed issuer and audience; signed for one minute and never outlives the Draft login. */
export function verifyDraftTicket(ticket: string, key: string, now = Date.now()): DraftTicket {
  const reject = () => { throw new LoginRejected("登录凭据已失效，请从 TQL 管理后台重新进入"); };
  if (key.length < 32 || ticket.length > 2048) return reject();
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return reject();
  const [payload, signature] = parts as [string, string];
  const expected = createHmac("sha256", key).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reject();
  let t: DraftTicket;
  try { t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return reject(); }
  if (!t || t.iss !== ISSUER || t.aud !== AUDIENCE || t.sub !== "tql-admin" || !/^[a-f0-9]{32}$/.test(t.jti ?? "")) return reject();
  if (![t.iat, t.exp, t.sessionExp].every(Number.isSafeInteger) || t.iat > now + 5000 || t.exp <= now || t.exp <= t.iat || t.exp - t.iat > 60_000 || t.sessionExp <= now || t.sessionExp > t.iat + MAX_SESSION_MS) return reject();
  return t;
}

export async function draftSsoLogin(ticket: string, userAgent?: string) {
  const t = verifyDraftTicket(ticket, process.env.TQL_ADMIN_SSO_SECRET ?? "");
  return sql.begin(async tx => {
    await tx`DELETE FROM admin_sso_tickets WHERE expires_at < now()`;
    const used = await tx`INSERT INTO admin_sso_tickets (jti, expires_at) VALUES (${t.jti}, ${new Date(t.exp)}) ON CONFLICT DO NOTHING RETURNING jti`;
    if (!used.length) throw new LoginRejected("登录凭据已使用，请重新进入后台");
    const [user] = await tx<{id:number}[]>`INSERT INTO admin_users (email, display_name, last_login_at) VALUES ('admin@local', '管理员', now()) ON CONFLICT (email) DO UPDATE SET last_login_at = now() RETURNING id`;
    const token = await createSession(user!.id, userAgent, tx, new Date(t.sessionExp));
    await tx`INSERT INTO audit_log (actor, action, after) VALUES (${`admin:${user!.id}`}, 'auth.login', ${tx.json({method:"draft_sso"})})`;
    return {token, maxAge: Math.max(1, Math.floor((t.sessionExp - Date.now())/1000))};
  });
}

import "./setup.ts";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, test } from "node:test";
import Fastify from "fastify";
import { registerAdminAuth, adminHandler } from "../apps/api/src/routes/admin-auth.ts";
import { draftSsoLogin, verifyDraftTicket, type DraftTicket } from "@aihot/backend/admin/draft-sso";
import { endSession, sessionPrincipal, SESSION_COOKIE } from "@aihot/backend/admin/auth";
import { sql, closeDb } from "@aihot/backend/db";
const key = "test-draft-sso-secret-at-least-32-characters";
process.env.TQL_ADMIN_SSO_SECRET = key;
const signed = (patch: Partial<DraftTicket> = {}) => {
  const now=Date.now();
  const t={iss:"https://fftql.team",aud:"https://news.fftql.team",sub:"tql-admin",iat:now,exp:now+60_000,sessionExp:now+3600_000,jti:randomBytes(16).toString("hex"),...patch};
  const p=Buffer.from(JSON.stringify(t)).toString("base64url");
  return {ticket:`${p}.${createHmac("sha256",key).update(p).digest("base64url")}`,t};
};
const used:string[]=[];
after(async()=>{for(const jti of used) await sql`DELETE FROM admin_sso_tickets WHERE jti=${jti}`; await closeDb();});

test("SSO rejects tampering, wrong audience/issuer, expired and overlong leases",()=>{
  const {ticket,t}=signed();
  assert.equal(verifyDraftTicket(ticket,key).jti,t.jti);
  assert.throws(()=>verifyDraftTicket(ticket,key+"wrong"));
  assert.throws(()=>verifyDraftTicket(ticket+".extra",key));
  for(const patch of [{aud:"https://evil.example"},{iss:"https://evil.example"},{sub:"reader"},{exp:Date.now()-1},{iat:Date.now()+60_000},{exp:Date.now()+120_000},{sessionExp:Date.now()+8*86400_000},{sessionExp:Date.now()-1},{jti:"oops"}]) assert.throws(()=>verifyDraftTicket(signed(patch).ticket,key));
});

test("SSO ticket is atomic, one-use and preserves the original login expiry",async()=>{
  const {ticket,t}=signed();used.push(t.jti);
  const answers=await Promise.allSettled([draftSsoLogin(ticket,"sso-test"),draftSsoLogin(ticket,"sso-test")]);
  assert.equal(answers.filter(r=>r.status==="fulfilled").length,1);
  const success=answers.find(r=>r.status==="fulfilled")!;
  if(success.status!=="fulfilled") throw new Error("no login");
  const cookie=`${SESSION_COOKIE}=${success.value.token}`;
  assert.ok((await sessionPrincipal(cookie))?.csrf);
  const [row]=await sql<{expires_at:Date}[]>`SELECT expires_at FROM admin_sessions WHERE user_agent='sso-test' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(row!.expires_at.getTime(),t.sessionExp);
  await endSession(cookie);
  assert.equal(await sessionPrincipal(cookie),null);
});

test("SSO accepts only the fixed origin over POST; the issued session retains CSRF protection",async()=>{
  const app=Fastify({logger:false});registerAdminAuth(app);
  app.post("/api/admin/sso-test-write", adminHandler(async()=>({ok:true})));
  const {ticket,t}=signed();used.push(t.jti);
  try {
    assert.equal((await app.inject({method:"GET",url:"/api/auth/draft-sso"})).statusCode,404);
    assert.equal((await app.inject({method:"POST",url:"/api/auth/draft-sso",payload:{ticket},headers:{origin:"https://evil.example"}})).statusCode,403);
    const response=await app.inject({method:"POST",url:"/api/auth/draft-sso",payload:{ticket},headers:{origin:"https://fftql.team"}});
    assert.equal(response.statusCode,303);
    assert.equal(response.headers.location,"/admin");
    const setCookie=String(response.headers["set-cookie"]);
    assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);
    const cookie=setCookie.split(";")[0]!;
    const me=await app.inject({url:"/api/admin/me",headers:{cookie}});
    assert.equal(me.statusCode,200);assert.ok(me.json().csrf);
    assert.equal((await app.inject({method:"POST",url:"/api/admin/sso-test-write",headers:{cookie}})).statusCode,403);
    assert.equal((await app.inject({method:"POST",url:"/api/admin/sso-test-write",headers:{cookie,"x-csrf-token":me.json().csrf}})).statusCode,200);
    assert.equal((await app.inject({method:"POST",url:"/api/auth/draft-sso",payload:{ticket},headers:{origin:"https://fftql.team"}})).headers.location,"/admin/login?return=%2Fadmin&error=sso-expired");
    await endSession(cookie);
  } finally {await app.close();}
});

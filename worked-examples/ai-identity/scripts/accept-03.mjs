// Acceptance runner for spec 03 — Scopes & consent.
// Uses the generalized flow driver plus low-level helpers for the consent
// binding proof. Resource = the Notes API (RFC 8707) so access tokens are JWTs.

import { randomBytes, createHash } from "node:crypto";
import { runOAuthFlow } from "./run-oauth-flow.mjs";

const BASE = "http://localhost:3000";
const ORIGIN = BASE;
const RESOURCE = process.env.NOTES_RESOURCE_URL ?? "http://localhost:3000/api/notes";
const READ = { id: process.env.READ_CLIENT_ID, secret: process.env.READ_CLIENT_SECRET };
const WRITE = { id: process.env.WRITE_CLIENT_ID, secret: process.env.WRITE_CLIENT_SECRET };

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
}
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function callNotes(method, token) {
  const res = await fetch(BASE + "/api/notes", {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

// ---------- AC-1: scopes advertised ----------
const disc = await (await fetch(BASE + "/api/auth/.well-known/openid-configuration")).json();
{
  const s = disc.scopes_supported ?? [];
  record("AC-1", s.includes("notes.read") && s.includes("notes.write"), `scopes_supported = ${JSON.stringify(s)}`);
}

// ---------- low-level helpers for the consent binding proof ----------
async function signInJar(email, password) {
  const jar = new Map();
  const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => {
    const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1));
  });
  const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const post = (path, body) => fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() },
    body: JSON.stringify(body), redirect: "manual",
  }).then((r) => { absorb(r); return r; });
  await post("/api/auth/sign-up/email", { name: "Consent Tester", email, password });
  await post("/api/auth/sign-in/email", { email, password });
  return { ck };
}

async function authorizeGetSignedQuery({ client, scope, resource, ck }) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const u = new URL(disc.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code", client_id: client, redirect_uri: "http://localhost:3000/callback",
    scope, state: "s", nonce: "n", code_challenge: challenge, code_challenge_method: "S256",
    ...(resource ? { resource } : {}),
  }).toString();
  const r = await fetch(u, { headers: { Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, redirect: "manual" });
  const data = await r.json().catch(() => ({}));
  const url = new URL(data.url ?? data.redirect, BASE);
  return { consentUrl: url, signedQuery: url.search.replace(/^\?/, ""), scopeParam: url.searchParams.get("scope"), ck };
}
async function postConsent(signedQuery, accept, ck) {
  const r = await fetch(BASE + "/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() },
    body: JSON.stringify({ accept, oauth_query: signedQuery }), redirect: "manual",
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// ---------- AC-2 + AC-9: consent screen shows exactly the requested scopes, parsed from the signed query ----------
{
  const { ck } = await signInJar(`consent-${b64url(randomBytes(5))}@authco.test`, "consent strong password 1");
  const a = await authorizeGetSignedQuery({ client: WRITE.id, scope: "openid notes.read notes.write", resource: RESOURCE, ck });
  const shown = (a.scopeParam ?? "").split(/\s+/).filter(Boolean);
  const exact = shown.includes("notes.read") && shown.includes("notes.write") &&
    shown.every((s) => ["openid", "notes.read", "notes.write"].includes(s));
  record("AC-2", a.consentUrl.pathname === "/consent" && exact,
    `consent path=${a.consentUrl.pathname}, scopes the screen parses = ${JSON.stringify(shown)}`);

  // AC-9 binding: the screen reads `scope` from the SIGNED query. Tampering the
  // scope (adding notes.write where not asked... here add an extra) breaks the
  // signature, so an inflated display can never be approved into a grant.
  const tampered = a.signedQuery.replace(/scope=[^&]*/, "scope=" + encodeURIComponent("openid notes.read notes.write notes.delete"));
  const tamperRes = await postConsent(tampered, true, ck);
  const tamperRejected = tamperRes.status >= 400 || tamperRes.data?.error;
  record("AC-9", tamperRejected,
    `tampered-scope consent -> ${tamperRes.status} ${JSON.stringify(tamperRes.data).slice(0, 60)} (must be rejected)`);
}

// ---------- AC-3: read-only grant -> read works ----------
const readFlow = await runOAuthFlow({ clientId: READ.id, clientSecret: READ.secret, scope: "openid notes.read", resource: RESOURCE });
{
  const granted = (readFlow.grantedScope ?? "").split(/\s+/);
  const read = await callNotes("GET", readFlow.accessToken);
  record("AC-3", granted.includes("notes.read") && read.status === 200,
    `granted=${readFlow.grantedScope}; GET /api/notes -> ${read.status}`);
}

// ---------- AC-4: read+write grant -> read AND write work ----------
const writeFlow = await runOAuthFlow({ clientId: WRITE.id, clientSecret: WRITE.secret, scope: "openid notes.read notes.write", resource: RESOURCE });
{
  const r = await callNotes("GET", writeFlow.accessToken);
  const w = await callNotes("POST", writeFlow.accessToken);
  record("AC-4", r.status === 200 && w.status === 200, `granted=${writeFlow.grantedScope}; read=${r.status}, write=${w.status}`);
}

// ---------- AC-5: read-only token at the write action -> 403, never 200 ----------
{
  const w = await callNotes("POST", readFlow.accessToken);
  record("AC-5", w.status === 403 || w.status === 401, `read-only token -> POST /api/notes = ${w.status} (${w.body?.error}); never 200`);
}

// ---------- AC-6: no escalation at registration ----------
{
  // read-client asks for notes.write (not registered) -> rejected, never granted
  const esc = await runOAuthFlow({ clientId: READ.id, clientSecret: READ.secret, scope: "openid notes.read notes.write", resource: RESOURCE });
  const grantedHasWrite = (esc.grantedScope ?? "").split(/\s+/).includes("notes.write");
  record("AC-6", !!esc.authorizeError && !grantedHasWrite,
    `read-client requests notes.write -> ${esc.authorizeError ?? "issued"}; granted has notes.write=${grantedHasWrite}`);
}

// ---------- AC-7: Deny issues nothing ----------
{
  const deny = await runOAuthFlow({ clientId: WRITE.id, clientSecret: WRITE.secret, scope: "openid notes.read notes.write", resource: RESOURCE, accept: false });
  record("AC-7", deny.denied === true && !deny.code && !deny.accessToken,
    `deny -> code=${deny.code}, token=${!!deny.accessToken}, error=${deny.denyError}`);
}

// ---------- AC-8: missing/invalid token -> 401 (not 200, not 500) ----------
{
  const noneGet = await callNotes("GET", undefined);
  const nonePost = await callNotes("POST", undefined);
  const garbageGet = await callNotes("GET", "garbage.not.a.jwt");
  const ok = [noneGet, nonePost, garbageGet].every((r) => r.status === 401);
  record("AC-8", ok, `no-token GET=${noneGet.status} POST=${nonePost.status}; garbage GET=${garbageGet.status} (all must be 401)`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

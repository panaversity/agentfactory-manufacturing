// Acceptance runner for spec 06 — Client identity with CIMD.
// Drives the live AuthCo authorize/consent/token endpoints with URL client_ids.
// Run with:  node --env-file=.env scripts/accept-06.mjs   (+ spec02 CLIENT_* in env)

import { randomBytes, createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const BASE = "http://localhost:3000";
const ORIGIN = BASE;
const CIMD = "http://localhost:8787";
const URL_CLIENT = `${CIMD}/oauth-client.json`;
const URL_REDIRECT = `${CIMD}/callback`;
const sql = neon(process.env.DATABASE_URL);

const results = [];
const record = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };
const b64 = (b) => Buffer.from(b).toString("base64url");

// A signed-in AuthCo session (the human approving the flow).
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpost = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(body), redirect: "manual" }).then((r) => { absorb(r); return r; });
const email = `cimd-accept-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jpost("/api/auth/sign-up/email", { name: "CIMD Accept", email, password: "cimd accept strong pw 1" });
await jpost("/api/auth/sign-in/email", { email, password: "cimd accept strong pw 1" });

// One authorize attempt. Returns where it landed: consent / code / error.
async function authorize(clientId, redirectUri, challenge) {
  const u = new URL(BASE + "/api/auth/oauth2/authorize");
  u.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    scope: "openid profile email", state: "s",
    code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  const r = await fetch(u, { headers: { Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, redirect: "manual" });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  const next = data?.url ?? data?.redirect ?? r.headers.get("location") ?? "";
  let parsed = null; try { parsed = new URL(next, BASE); } catch {}
  const error = parsed?.searchParams.get("error") ?? data?.error ?? (r.status >= 400 ? `http_${r.status}` : null);
  const reachedConsent = parsed?.pathname === "/consent";
  const gotCode = !!parsed?.searchParams.get("code");
  return { status: r.status, error, reachedConsent, gotCode, next, signedQuery: parsed?.search?.replace(/^\?/, "") ?? "" };
}

// A full URL-client_id flow (public client: PKCE, no secret).
async function cimdFlow(clientId, redirectUri) {
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  const a = await authorize(clientId, redirectUri, challenge);
  if (a.error || (!a.reachedConsent && !a.gotCode)) return { ...a, token: null };
  let code = a.gotCode ? new URL(a.next, BASE).searchParams.get("code") : null;
  if (!code) {
    const cons = await jpost("/api/auth/oauth2/consent", { accept: true, oauth_query: a.signedQuery });
    const cd = await cons.json().catch(() => ({}));
    code = new URL(cd.url ?? cd.redirect, BASE).searchParams.get("code");
  }
  const tr = await fetch(BASE + "/api/auth/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId }).toString() });
  const td = await tr.json().catch(() => ({}));
  return { ...a, tokenStatus: tr.status, token: td.id_token ?? null, tokenError: td.error ?? null };
}

// ===== AC-1: discovery advertises CIMD =====
{
  const disc = await (await fetch(BASE + "/api/auth/.well-known/openid-configuration")).json();
  record("AC-1", disc.client_id_metadata_document_supported === true,
    `client_id_metadata_document_supported = ${disc.client_id_metadata_document_supported}`);
}

// ===== AC-2: URL client_id resolved by FETCH, not a seeded record; public cache row appears =====
{
  // delete any cache row so this run genuinely re-fetches the document
  await sql`DELETE FROM "oauthClient" WHERE "clientId" = ${URL_CLIENT}`;
  const before = await sql`SELECT count(*)::int AS n FROM "oauthClient" WHERE "clientId" = ${URL_CLIENT}`;
  const flow = await cimdFlow(URL_CLIENT, URL_REDIRECT);
  const row = (await sql`SELECT public, ("clientSecret" IS NULL) AS secret_null FROM "oauthClient" WHERE "clientId" = ${URL_CLIENT}`)[0];
  const ok = flow.token && before[0].n === 0 && row?.public === true && row?.secret_null === true;
  record("AC-2", ok, `no row before=${before[0].n === 0}; flow issued token=${!!flow.token}; cache row public=${row?.public}, secret null=${row?.secret_null}`);
}

// ===== AC-3: the spec-02 confidential static client still works =====
{
  const CID = process.env.CLIENT_ID, CSEC = process.env.CLIENT_SECRET, RURI = process.env.REDIRECT_URI ?? "http://localhost:3000/callback";
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  const a = await authorize(CID, RURI, challenge);
  let code = null;
  if (a.reachedConsent) { const cons = await jpost("/api/auth/oauth2/consent", { accept: true, oauth_query: a.signedQuery }); code = new URL((await cons.json()).url, BASE).searchParams.get("code"); }
  else if (a.gotCode) code = new URL(a.next, BASE).searchParams.get("code");
  const basic = "Basic " + Buffer.from(`${CID}:${CSEC}`).toString("base64");
  const tr = await fetch(BASE + "/api/auth/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic, Origin: ORIGIN }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: RURI, code_verifier: verifier }).toString() });
  const td = await tr.json().catch(() => ({}));
  record("AC-3", tr.status === 200 && !!td.id_token, `confidential client ${CID}: token=${tr.status}, id_token=${!!td.id_token}`);
}

// ===== AC-4: non-HTTPS (non-loopback http) client_id rejected, no fetch =====
{
  const a = await authorize("http://example.com/oauth-client.json", "http://example.com/cb", b64(createHash("sha256").update("x").digest()));
  record("AC-4", !!a.error && !a.reachedConsent && !a.gotCode, `non-https client_id -> error=${a.error}, reachedConsent=${a.reachedConsent}`);
}

// ===== AC-5: malformed identifier (fragment / userinfo) rejected =====
{
  const frag = await authorize("https://app.example/oauth-client.json#x", "https://app.example/cb", b64(createHash("sha256").update("x").digest()));
  const user = await authorize("https://user:pass@app.example/oauth-client.json", "https://app.example/cb", b64(createHash("sha256").update("x").digest()));
  const rej = (a) => !!a.error && !a.reachedConsent && !a.gotCode;
  record("AC-5", rej(frag) && rej(user), `fragment -> ${frag.error}; userinfo -> ${user.error}`);
}

// ===== AC-6: document must match the request =====
{
  // (a) doc's self-declared client_id disagrees with its URL
  const wrongId = await cimdFlow(`${CIMD}/wrong-client-id.json`, URL_REDIRECT);
  // (b) requested redirect_uri not listed in the (valid) doc
  const badRedir = await cimdFlow(URL_CLIENT, `${CIMD}/not-a-listed-uri`);
  const rej = (f) => (f.error || (!f.token && f.tokenError) || (!f.reachedConsent && !f.gotCode)) && !f.token;
  record("AC-6", rej(wrongId) && rej(badRedir),
    `doc client_id mismatch -> token=${!!wrongId.token} (err=${wrongId.error ?? wrongId.tokenError}); unlisted redirect_uri -> token=${!!badRedir.token} (err=${badRedir.error ?? badRedir.tokenError})`);
}

// ===== AC-7: fails closed on unreachable / non-JSON =====
{
  const unreachable = await cimdFlow(`${CIMD}/does-not-exist.json`, URL_REDIRECT);   // 404
  const notJson = await cimdFlow(`${CIMD}/not-json`, URL_REDIRECT);                   // HTML
  const closed = await cimdFlow("http://localhost:8123/never.json", "http://localhost:8123/cb"); // closed port
  const failsClosed = (f) => !f.token;
  record("AC-7", failsClosed(unreachable) && failsClosed(notJson) && failsClosed(closed),
    `404 -> token=${!!unreachable.token}; non-JSON -> token=${!!notJson.token}; closed-port -> token=${!!closed.token} (all must be false)`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

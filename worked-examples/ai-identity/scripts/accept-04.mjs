// Acceptance runner for spec 04 — Connect a real app (Notes).
// Drives Notes's OWN code (../notes/lib/oauth.mjs) for token exchange, offline
// verification, and refresh. AuthCo is just the IdP. Run with:
//   node --env-file=notes/.env scripts/accept-04.mjs   (+ WRITE_CLIENT_* in env)

import { readFileSync, readdirSync } from "node:fs";
import { jwtVerify, createRemoteJWKSet } from "jose";
import * as notes from "../notes/lib/oauth.mjs";
import { runOAuthFlow } from "./run-oauth-flow.mjs";

const AUTHCO = process.env.AUTHCO_BASE_URL ?? "http://localhost:3000";
const ORIGIN = AUTHCO;
const NOTES_DIR = new URL("../notes/", import.meta.url).pathname;
const TEST_PASSWORD = "robin offline strong password 1"; // used only against AuthCo

const results = [];
const record = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

// --- AuthCo user + browser-session cookie jar ---
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpost = (path, body) => fetch(AUTHCO + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(body), redirect: "manual" }).then((r) => { absorb(r); return r; });

const email = `robin-offline-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jpost("/api/auth/sign-up/email", { name: "Robin Offline", email, password: TEST_PASSWORD });
await jpost("/api/auth/sign-in/email", { email, password: TEST_PASSWORD });

// Drive Notes's login as a browser would, return the code at Notes's callback.
async function driveLogin(scope) {
  const { verifier, challenge, state } = notes.newPkce();
  const authorizeUrl = await notes.buildAuthorizeUrl({ challenge, state, scope });
  const ar = await fetch(authorizeUrl, { headers: { Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, redirect: "manual" });
  let next = new URL((await ar.json()).url, AUTHCO);
  if (!next.searchParams.get("code")) {
    const cons = await jpost("/api/auth/oauth2/consent", { accept: true, oauth_query: next.search.replace(/^\?/, "") });
    next = new URL((await cons.json()).url, AUTHCO);
  }
  return { code: next.searchParams.get("code"), verifier, state, returnedState: next.searchParams.get("state") };
}

// ===== AC-1: authorize -> consent -> exchange -> signed ID token =====
const { code, verifier, state, returnedState } = await driveLogin("openid profile email offline_access");
const tok = await notes.exchangeCode({ code, verifier });
record("AC-1", tok.status === 200 && !!tok.data?.id_token && state === returnedState,
  `exchange=${tok.status}, id_token=${!!tok.data?.id_token}, state echoed=${state === returnedState}`);

// ===== AC-2 + AC-3: offline verify; aud == client_id, iss == issuer =====
const disc = await notes.discover();
let claims = null;
try { ({ payload: claims } = await notes.verifyIdToken(tok.data.id_token)); } catch (e) { claims = { _err: e.code }; }
record("AC-2", !!claims?.sub && Number.isFinite(claims?.exp),
  claims?._err ? `verify failed: ${claims._err}` : `verified offline: sub=${String(claims.sub).slice(0, 8)}…, exp=${new Date(claims.exp * 1000).toISOString()}`);
record("AC-3", claims?.aud === notes.config.CLIENT_ID && claims?.iss === disc.issuer,
  `aud=${JSON.stringify(claims?.aud)} (==client_id), iss=${claims?.iss} (==issuer)`);

// ===== AC-6: wrong aud / wrong iss rejected by Notes's verifier =====
{
  // a genuine token minted for ANOTHER client (aud != notes-app)
  const other = await runOAuthFlow({ clientId: process.env.WRITE_CLIENT_ID, clientSecret: process.env.WRITE_CLIENT_SECRET, scope: "openid" });
  let audRej = false, issRej = false;
  try { await notes.verifyIdToken(other.idToken); } catch (e) { audRej = e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED"; }
  try { await notes.verifyIdToken(tok.data.id_token, { expect: { issuer: "https://evil.example" } }); } catch (e) { issRej = e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED"; }
  record("AC-6", audRej && issRej, `wrong-aud token rejected=${audRej}; wrong-iss rejected=${issRej}`);
}

// ===== AC-8: expired token rejected offline (no call to AuthCo) =====
{
  let expired = false;
  try { await notes.verifyIdToken(tok.data.id_token, { currentDate: new Date((claims.exp + 5) * 1000) }); }
  catch (e) { expired = e.code === "ERR_JWT_EXPIRED"; }
  record("AC-8", expired, `token past exp -> ${expired ? "ERR_JWT_EXPIRED (offline)" : "WRONGLY accepted"}`);
}

// ===== AC-5: revocation bites — refresh works, then fails after revoke =====
{
  // Refresh tokens rotate, so to isolate REVOCATION from rotation: refresh once
  // (proves the mechanism works) to get the current valid token, revoke THAT
  // (unused) token, then refresh it again — any failure is revocation, not reuse.
  const before = await notes.refresh(tok.data.refresh_token);
  const current = before.data?.refresh_token ?? tok.data.refresh_token;
  const basic = "Basic " + Buffer.from(`${process.env.NOTES_CLIENT_ID}:${process.env.NOTES_CLIENT_SECRET}`).toString("base64");
  const rev = await fetch(disc.revocation_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic }, body: new URLSearchParams({ token: current, token_type_hint: "refresh_token" }).toString() });
  const after = await notes.refresh(current);
  record("AC-5", before.status === 200 && after.status !== 200,
    `refresh works=${before.status}; revoke current token=${rev.status}; refresh after revoke=${after.status} (must fail)`);
}

// ===== AC-4: offline, secretless — no AuthCo secret / DB path in Notes; JWKS required =====
{
  // read the AuthCo secret to prove it's absent from Notes (read here, never logged)
  const authEnv = readFileSync(new URL("../.env", import.meta.url).pathname, "utf8");
  const authSecret = (authEnv.match(/^BETTER_AUTH_SECRET=(.*)$/m) ?? [])[1]?.trim();
  const dbUrl = (authEnv.match(/^DATABASE_URL=(.*)$/m) ?? [])[1]?.trim();
  // scan every Notes source + its env
  const files = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (d.name === "node_modules") return;
    const full = dir + d.name + (d.isDirectory() ? "/" : "");
    d.isDirectory() ? walk(full) : files.push(full);
  });
  walk(NOTES_DIR);
  let leak = null;
  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    if (authSecret && txt.includes(authSecret)) leak = `BETTER_AUTH_SECRET value in ${f}`;
    if (dbUrl && txt.includes(dbUrl)) leak = `DATABASE_URL value in ${f}`;
    if (/BETTER_AUTH_SECRET|DATABASE_URL/.test(txt) && f.endsWith(".env")) leak = `${f} references BETTER_AUTH_SECRET/DATABASE_URL`;
  }
  // negative proof: with the JWKS endpoint unreachable, verification cannot happen
  let cannotVerifyWithoutJwks = false;
  try {
    const deadJwks = createRemoteJWKSet(new URL("http://127.0.0.1:9/jwks")); // unreachable port
    await jwtVerify(tok.data.id_token, deadJwks, { issuer: disc.issuer, audience: notes.config.CLIENT_ID });
  } catch { cannotVerifyWithoutJwks = true; }
  record("AC-4", leak === null && cannotVerifyWithoutJwks,
    leak ? `LEAK: ${leak}` : `no AuthCo secret/DB in Notes (${files.length} files scanned); verify impossible without JWKS=${cannotVerifyWithoutJwks}`);
}

// ===== AC-7: password never crosses to Notes =====
{
  // Notes's server log must not contain the user's password; Notes never has a sign-in form.
  let log = "";
  try { log = readFileSync(process.env.NOTES_LOG, "utf8"); } catch {}
  const inLog = TEST_PASSWORD && log.includes(TEST_PASSWORD);
  // structural: Notes only ever received a code + tokens (it has no /sign-in route)
  const notesSrc = readFileSync(new URL("../notes/server.mjs", import.meta.url).pathname, "utf8");
  const noPasswordHandling = !/password/i.test(notesSrc);
  record("AC-7", !inLog && noPasswordHandling,
    `password in Notes log=${!!inLog}; Notes server handles 'password'=${!noPasswordHandling} (both must be false)`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

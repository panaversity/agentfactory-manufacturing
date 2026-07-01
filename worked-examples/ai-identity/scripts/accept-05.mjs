// Acceptance runner for spec 05 — Connect a resource server.
// Drives the REAL resource server (http://localhost:8000) and uses its own
// verify module for the offline expiry check. Run with:
//   node --env-file=resource-server/.env scripts/accept-05.mjs   (+ WRITE_CLIENT_* in env)

import { readFileSync, readdirSync } from "node:fs";
import { jwtVerify, createRemoteJWKSet, SignJWT, generateKeyPair } from "jose";
import { verifyAccessToken } from "../resource-server/lib/verify.mjs";
import { runOAuthFlow } from "./run-oauth-flow.mjs";

const AUTHCO = process.env.AUTHCO_BASE_URL ?? "http://localhost:3000";
const RESOURCE_API = "http://localhost:8000/api/resource";
const AUTH_ISSUER = process.env.AUTH_ISSUER ?? "http://localhost:3000";
const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://localhost:8000";
const RS_DIR = new URL("../resource-server/", import.meta.url).pathname;

const results = [];
const record = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

// --- AuthCo session, then GET /api/auth/token (FR-5) ---
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpost = (path, body) => fetch(AUTHCO + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: AUTHCO, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(body), redirect: "manual" }).then((r) => { absorb(r); return r; });

const email = `rs-accept-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jpost("/api/auth/sign-up/email", { name: "RS Accept", email, password: "rs accept strong password 1" });
await jpost("/api/auth/sign-in/email", { email, password: "rs accept strong password 1" });
const tokRes = await fetch(AUTHCO + "/api/auth/token", { headers: { Cookie: ck() } });
const TOKEN = (await tokRes.json()).token;
const myClaims = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString());

async function callApi(token) {
  const res = await fetch(RESOURCE_API, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

// ===== AC-1: valid token accepted, attributed to sub =====
{
  const r = await callApi(TOKEN);
  record("AC-1", r.status === 200 && r.body?.user === myClaims.sub,
    `GET /api/resource -> ${r.status}, user=${String(r.body?.user).slice(0, 8)}… (== token sub=${r.body?.user === myClaims.sub})`);
}

// ===== AC-6 (positive half): RS256 alg matches; (negative half below) =====
const alg = JSON.parse(Buffer.from(TOKEN.split(".")[0], "base64url").toString()).alg;

// ===== AC-3: tampered token -> 401 =====
{
  const [h, p, s] = TOKEN.split(".");
  const flipped = s.slice(0, -2) + (s.slice(-2, -1) === "A" ? "B" : "A") + s.slice(-1);
  const r = await callApi(`${h}.${p}.${flipped}`);
  record("AC-3", r.status === 401, `tampered signature -> ${r.status} (${r.body?.reason ?? r.body?.error})`);
}

// ===== AC-4: wrong audience -> 401 (token AuthCo signed, but for another aud) =====
{
  // an oauth-provider ID token: aud = a client_id, not RESOURCE_URL
  const other = await runOAuthFlow({ clientId: process.env.WRITE_CLIENT_ID, clientSecret: process.env.WRITE_CLIENT_SECRET, scope: "openid" });
  const otherAud = JSON.parse(Buffer.from(other.idToken.split(".")[1], "base64url").toString()).aud;
  const r = await callApi(other.idToken);
  record("AC-4", r.status === 401, `token aud=${JSON.stringify(otherAud)} (!= ${RESOURCE_URL}) -> ${r.status} (${r.body?.reason})`);
}

// ===== AC-5: expired -> rejected offline (resource's own verifier, no AuthCo call) =====
{
  let code = null;
  try { await verifyAccessToken(TOKEN, { currentDate: new Date((myClaims.exp + 5) * 1000) }); }
  catch (e) { code = e.code; }
  record("AC-5", code === "ERR_JWT_EXPIRED", `past-exp verify (offline) -> ${code ?? "ACCEPTED(!!)"}`);
}

// ===== AC-6 (negative half): an EdDSA token is rejected by the RS256-only verifier =====
{
  const { privateKey } = await generateKeyPair("EdDSA"); // a key NOT in AuthCo's JWKS, wrong alg
  const eddsa = await new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(AUTH_ISSUER).setAudience(RESOURCE_URL).setSubject("attacker")
    .setExpirationTime("1h").sign(privateKey);
  const r = await callApi(eddsa);
  record("AC-6", alg === "RS256" && r.status === 401,
    `issuer alg=${alg}; EdDSA token -> ${r.status} (${r.body?.reason}) — RS256-only verifier refuses it`);
}

// ===== AC-2: offline, secretless — no AuthCo secret/DB in resource-server; JWKS required =====
{
  const authEnv = readFileSync(new URL("../.env", import.meta.url).pathname, "utf8");
  const authSecret = (authEnv.match(/^BETTER_AUTH_SECRET=(.*)$/m) ?? [])[1]?.trim();
  const dbUrl = (authEnv.match(/^DATABASE_URL=(.*)$/m) ?? [])[1]?.trim();
  const files = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (d.name === "node_modules") return;
    const full = dir + d.name + (d.isDirectory() ? "/" : "");
    d.isDirectory() ? walk(full) : files.push(full);
  });
  walk(RS_DIR);
  let leak = null;
  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    if (authSecret && txt.includes(authSecret)) leak = `BETTER_AUTH_SECRET value in ${f}`;
    if (dbUrl && txt.includes(dbUrl)) leak = `DATABASE_URL value in ${f}`;
    if (f.endsWith(".env") && /BETTER_AUTH_SECRET|DATABASE_URL/.test(txt)) leak = `${f} references a secret/DB`;
  }
  let cannotVerifyWithoutJwks = false;
  try {
    const dead = createRemoteJWKSet(new URL("http://127.0.0.1:9/jwks"));
    await jwtVerify(TOKEN, dead, { issuer: AUTH_ISSUER, audience: RESOURCE_URL, algorithms: ["RS256"] });
  } catch { cannotVerifyWithoutJwks = true; }
  record("AC-2", leak === null && cannotVerifyWithoutJwks,
    leak ? `LEAK: ${leak}` : `no AuthCo secret/DB in resource-server (${files.length} files); verify needs JWKS=${cannotVerifyWithoutJwks}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

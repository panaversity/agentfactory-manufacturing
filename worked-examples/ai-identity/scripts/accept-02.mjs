// Acceptance runner for spec 02 — Become the issuer.
//
// Ties together the independent verifier (verify-token.mjs) and the headless
// flow driver (run-oauth-flow.mjs), then runs the adversarial checks.
//
// Run with:
//   node --env-file=.env scripts/accept-02.mjs       (CLIENT_* sourced into env)

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { runOAuthFlow } from "./run-oauth-flow.mjs";
import { verifyToken } from "./verify-token.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const DEVLOG = process.env.DEVLOG;
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
}

// ---- AC-1: discovery + JWKS are valid JSON, JWKS has >=1 public key ----
const discRes = await fetch(BASE + "/api/auth/.well-known/openid-configuration");
const disc = await discRes.json();
const jwksRes = await fetch(BASE + "/api/auth/jwks");
const jwksText = await jwksRes.text();
const jwks = JSON.parse(jwksText);
record(
  "AC-1",
  discRes.ok && !!disc.issuer && !!disc.authorization_endpoint && Array.isArray(jwks.keys) && jwks.keys.length >= 1,
  `discovery issuer=${disc.issuer}; jwks keys=${jwks.keys?.length}`
);

// ---- AC-4: JWKS exposes public params only (no d/p/q/private material) ----
{
  const PRIVATE = ["d", "p", "q", "dp", "dq", "qi", "k"];
  const leaked = [];
  for (const key of jwks.keys ?? []) {
    for (const f of PRIVATE) if (f in key) leaked.push(`${key.kid ?? "?"}.${f}`);
  }
  record("AC-4", leaked.length === 0, leaked.length ? `private params present: ${leaked.join(",")}` : `public-only (params: ${Object.keys(jwks.keys[0]).join(",")})`);
}

// ---- AC-2 + AC-8: run the full auth-code + PKCE flow ----
const flow = await runOAuthFlow();
{
  const parts = (flow.idToken ?? "").split(".");
  let alg = null;
  try { alg = JSON.parse(Buffer.from(parts[0], "base64url").toString()).alg; } catch {}
  record(
    "AC-2",
    parts.length === 3 && !!alg && flow.consentExercised,
    `id_token parts=${parts.length}, alg=${alg}, consent exercised=${flow.consentExercised}`
  );
  record(
    "AC-8",
    flow.replay.error === "invalid_grant" && !flow.replay.gotSecondToken,
    `code replay -> ${flow.replay.status} ${flow.replay.error}, second token=${flow.replay.gotSecondToken}`
  );
}

// ---- AC-3: independent verifier accepts the token; claims read correctly ----
const okVerify = await verifyToken(flow.idToken, {
  jwksUrl: flow.jwksUrl,
  issuer: flow.issuer,
  audience: flow.audience,
});
{
  const p = okVerify.payload ?? {};
  const claimsOk =
    okVerify.ok && p.iss === flow.issuer && p.aud === flow.audience && !!p.sub && Number.isFinite(p.exp);
  record(
    "AC-3",
    claimsOk,
    okVerify.ok
      ? `verified: iss=${p.iss}, aud=${p.aud}, sub=${String(p.sub).slice(0, 8)}…, exp=${new Date(p.exp * 1000).toISOString()}`
      : `verify failed: ${okVerify.code} ${okVerify.message}`
  );
}

// ---- AC-6: a token past exp is rejected (ERR_JWT_EXPIRED) ----
{
  const exp = okVerify.payload?.exp ?? Math.floor(Date.now() / 1000);
  const afterExpiry = new Date((exp + 5) * 1000);
  const r = await verifyToken(flow.idToken, {
    jwksUrl: flow.jwksUrl,
    issuer: flow.issuer,
    audience: flow.audience,
    currentDate: afterExpiry,
  });
  record("AC-6", !r.ok && r.code === "ERR_JWT_EXPIRED", r.ok ? "expired token WRONGLY accepted" : `rejected with ${r.code}`);
}

// ---- AC-7: wrong aud or wrong iss is rejected ----
{
  const wrongAud = await verifyToken(flow.idToken, { jwksUrl: flow.jwksUrl, issuer: flow.issuer, audience: "some-other-client" });
  const wrongIss = await verifyToken(flow.idToken, { jwksUrl: flow.jwksUrl, issuer: "https://evil.example", audience: flow.audience });
  record(
    "AC-7",
    !wrongAud.ok && !wrongIss.ok,
    `wrong aud -> ${wrongAud.ok ? "ACCEPTED(!)" : wrongAud.code}; wrong iss -> ${wrongIss.ok ? "ACCEPTED(!)" : wrongIss.code}`
  );
}

// ---- AC-9: client secret stored hashed at rest (never plaintext) ----
{
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`SELECT "clientSecret" AS s FROM "oauthClient" WHERE "clientId" = ${CLIENT_ID}`;
  const stored = rows[0]?.s ?? "";
  const expectedHash = b64url(createHash("sha256").update(CLIENT_SECRET).digest());
  const isPlaintext = stored === CLIENT_SECRET;
  const isHash = stored === expectedHash;
  record(
    "AC-9",
    !isPlaintext && isHash,
    isPlaintext ? "stored as PLAINTEXT (!)" : `stored = base64url(SHA-256(secret)), len=${stored.length}, matches hash=${isHash}`
  );
}

// ---- AC-5: no signing key / client secret / BETTER_AUTH_SECRET in logs or bodies ----
{
  const authSecret = process.env.BETTER_AUTH_SECRET ?? "";
  const log = DEVLOG ? readFileSync(DEVLOG, "utf8") : "";
  const bodies = [
    ["discovery", JSON.stringify(disc)],
    ["jwks", jwksText],
  ];
  let leak = null;
  // private signing material must never appear in the JWKS body
  if (/"d"\s*:/.test(jwksText)) leak = "private key 'd' in JWKS body";
  for (const [label, text] of bodies) {
    if (CLIENT_SECRET && text.includes(CLIENT_SECRET)) leak = `${label} contains client secret`;
    if (authSecret && text.includes(authSecret)) leak = `${label} contains BETTER_AUTH_SECRET`;
  }
  if (CLIENT_SECRET && log.includes(CLIENT_SECRET)) leak = "client secret in server log";
  if (authSecret && log.includes(authSecret)) leak = "BETTER_AUTH_SECRET in server log";
  record("AC-5", leak === null, leak ?? "no signing key / client secret / BETTER_AUTH_SECRET in logs or bodies");
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

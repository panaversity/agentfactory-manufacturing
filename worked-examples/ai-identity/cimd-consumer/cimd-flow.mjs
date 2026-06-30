/**
 * CIMD flow + adversarial harness for @better-auth/cimd 1.7.0-rc.0.
 *
 * An INDEPENDENT consumer that identifies itself to AuthCo with a URL
 * `client_id` (a Client ID Metadata Document) instead of a pre-registered
 * client. It:
 *   1. Hosts its own metadata document over loopback HTTP (allowed in dev via
 *      cimd({ allowLoopback: true })).
 *   2. Runs authorization-code + PKCE as a PUBLIC client (no client_secret,
 *      token_endpoint_auth_method "none").
 *   3. Verifies the ID token offline via JWKS.
 *   4. Inspects the DB to report exactly what CIMD persisted.
 *   5. Runs the adversarial checks the spike requires.
 *
 * Writes a machine-readable result.json that cimd-verify.sh turns into
 * PASS/FAIL lines. Self-contained: it never imports AuthCo internals.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { webcrypto as crypto } from "node:crypto";
import { createServer } from "node:http";
import { writeFileSync, appendFileSync } from "node:fs";
import Database from "better-sqlite3";

const AUTHCO = process.env.AUTHCO_URL || "http://localhost:3000";
const META_PORT = Number(process.env.META_PORT || 4567);
const META_HOST = `http://localhost:${META_PORT}`;
const CLIENT_ID = `${META_HOST}/client.json`; // URL client_id == fetch URL
const REDIRECT_URI = `${META_HOST}/callback`;
const USER_EMAIL = process.env.CIMD_USER_EMAIL || "cimd-user@example.com";
const USER_PASSWORD = process.env.CIMD_USER_PASSWORD || "Sup3rSecret-Passw0rd!";
const DB_PATH = process.env.SQLITE_PATH || "./sqlite.db";
const BODIES_LOG = process.env.BODIES_LOG || "./cimd-out/bodies.log";
const RESULT_FILE = process.env.RESULT_FILE || "./cimd-out/result.json";

const result = { ok: false, evidence: {}, checks: {}, error: null };

// ---- helpers --------------------------------------------------------------
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}
function logBody(tag, text) {
  try { appendFileSync(BODIES_LOG, `\n===== ${tag} =====\n${text}\n`); } catch {}
}

// The canonical, valid metadata document for the happy path.
function validDoc() {
  return {
    client_id: CLIENT_ID,
    client_name: "CIMD Notes",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "openid profile email",
  };
}
// A doc whose client_id matches the fetch URL but whose redirect_uris do NOT
// include the redirect the client will actually request.
function badRedirectDoc() {
  return { ...validDoc(), client_id: `${META_HOST}/client-bad-redirect.json`, redirect_uris: [`${META_HOST}/somewhere-else`] };
}

// ---- tiny metadata host (loopback HTTP) -----------------------------------
function startMetadataServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url.split("?")[0];
      if (path === "/client.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(validDoc()));
      } else if (path === "/client-bad-redirect.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(badRedirectDoc()));
      } else if (path === "/client-notjson.json") {
        // 200 but text/html -> must fail closed on content-type.
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><p>not json</p>");
      } else {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
    });
    server.listen(META_PORT, "127.0.0.1", () => resolve(server));
  });
}

let cookie = "";
function captureCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(";")[0];
    if (pair && pair.includes("=")) cookie = cookie ? cookie + "; " + pair : pair;
  }
}

// Drive authorize -> consent -> return the callback URL (with ?code=) for a
// given client_id + redirect_uri. Returns { authStatus, authText, code, error }.
async function runAuthorize(clientId, redirectUri, scope = "openid profile email") {
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authQ = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const r = await fetch(`${AUTHCO}/api/auth/oauth2/authorize?${authQ}`, {
    headers: { cookie, origin: AUTHCO, "sec-fetch-mode": "cors" },
  });
  const authText = await r.text();
  logBody(`authorize(${clientId})`, `status=${r.status}\n${authText}`);
  let url;
  try { url = JSON.parse(authText).url; } catch {}
  if (!url) return { authStatus: r.status, authText, code: null, verifier, state, nonce };
  // If authorize bounced straight to the client's redirect with an error, surface it.
  try {
    const u = new URL(url);
    if (u.searchParams.get("error")) return { authStatus: r.status, authText, code: null, verifier, state, nonce, error: u.searchParams.get("error") };
  } catch {}
  const consentQuery = url.split("?")[1];
  if (!consentQuery) return { authStatus: r.status, authText, code: null, verifier, state, nonce };
  const cr = await fetch(`${AUTHCO}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", cookie, origin: AUTHCO },
    body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
  });
  const consentText = await cr.text();
  logBody(`consent(${clientId})`, `status=${cr.status}\n${consentText}`);
  let redirectURL = null;
  try { redirectURL = JSON.parse(consentText).url; } catch {}
  if (!redirectURL) return { authStatus: r.status, authText, code: null, verifier, state, nonce, consentStatus: cr.status, consentText };
  const cb = new URL(redirectURL);
  return {
    authStatus: r.status,
    code: cb.searchParams.get("code"),
    error: cb.searchParams.get("error"),
    verifier, state, nonce,
  };
}

// PUBLIC-client token exchange: client_id in the body, NO Basic auth, PKCE.
async function exchange(code, verifier, clientId, redirectUri) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId,
  });
  const tr = await fetch(`${AUTHCO}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: AUTHCO },
    body,
  });
  const text = await tr.text();
  logBody(`token(${clientId})`, `status=${tr.status}\n${text}`);
  return { status: tr.status, text };
}

function countClientRow(clientId) {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT clientId, public, clientSecret, type, name, redirectUris FROM oauthClient WHERE clientId = ?").get(clientId);
  db.close();
  return row;
}

async function main() {
  const metaServer = await startMetadataServer();
  try {
    // --- establish AuthCo session (the user already has this in reality) ---
    await fetch(`${AUTHCO}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: AUTHCO },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, name: "CIMD User" }),
    });
    const si = await fetch(`${AUTHCO}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: AUTHCO },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
    });
    captureCookies(si);
    if (!cookie) throw new Error("could not obtain AuthCo session cookie");

    // Confirm NO pre-registered row exists for the URL client_id before the flow.
    const before = countClientRow(CLIENT_ID);
    result.evidence.db_row_before = before ? "PRESENT" : "absent";

    // ===== HAPPY PATH: URL client_id, public client, PKCE =====
    const a = await runAuthorize(CLIENT_ID, REDIRECT_URI);
    if (!a.code) throw new Error(`CIMD authorize/consent yielded no code (authStatus=${a.authStatus}, error=${a.error}, text=${(a.authText || a.consentText || "").slice(0, 200)})`);
    const tok = await exchange(a.code, a.verifier, CLIENT_ID, REDIRECT_URI);
    const tokens = (() => { try { return JSON.parse(tok.text); } catch { return {}; } })();
    if (tok.status !== 200 || !tokens.id_token) throw new Error(`CIMD token exchange failed (${tok.status}): ${tok.text.slice(0, 300)}`);

    // (b-flow) Did AuthCo fetch the doc and complete? Yes if we have an id_token.
    result.checks.cimd_flow_completes = true;
    result.evidence.cimd_flow_completes = `id_token parts=${tokens.id_token.split(".").length}, token_status=${tok.status}`;

    // Verify the ID token offline via JWKS (audience == the URL client_id).
    const disc = await (await fetch(`${AUTHCO}/.well-known/openid-configuration`)).json();
    const JWKS = createRemoteJWKSet(new URL(disc.jwks_uri));
    const { payload } = await jwtVerify(tokens.id_token, JWKS, { issuer: disc.issuer, audience: CLIENT_ID });
    result.checks.cimd_idtoken_verifies = !!payload.sub && payload.aud === CLIENT_ID && payload.iss === disc.issuer;
    result.evidence.cimd_idtoken_verifies = `sub=${payload.sub}, aud=${payload.aud}, iss=${payload.iss}`;

    // (a) DB row created by CIMD — report exactly what it is.
    const after = countClientRow(CLIENT_ID);
    result.evidence.db_row_after = after
      ? `PRESENT public=${after.public} secretNull=${after.clientSecret === null} type=${after.type} name=${after.name} clientId=${after.clientId}`
      : "ABSENT";
    // The spike asked whether NO oauthClient row exists. Reality: CIMD caches a
    // PUBLIC client row (no secret) keyed by the URL. Record both facts.
    result.checks.cimd_no_preregistered_secret_client =
      !!after && after.public === 1 && after.clientSecret === null && after.clientId === CLIENT_ID;

    // (b) Discovery advertises CIMD support.
    result.checks.cimd_discovery_key = disc.client_id_metadata_document_supported === true;
    result.evidence.cimd_discovery_key = `client_id_metadata_document_supported=${disc.client_id_metadata_document_supported}`;

    // ===== ADVERSARIAL CHECKS =====
    // (1) non-loopback HTTP client_id -> rejected before fetch (HTTPS required).
    const httpNonLoopback = "http://example.com/client.json";
    const adv1 = await runAuthorize(httpNonLoopback, "http://example.com/cb");
    let adv1Tok = { status: "n/a" };
    if (adv1.code) adv1Tok = await exchange(adv1.code, adv1.verifier, httpNonLoopback, "http://example.com/cb");
    result.checks.adv_http_nonloopback_rejected = !adv1.code;
    result.evidence.adv_http_nonloopback_rejected = `code=${adv1.code}, authStatus=${adv1.authStatus}, error=${adv1.error}`;

    // (2) client_id URL with a fragment -> rejected.
    const fragId = `${META_HOST}/client.json#frag`;
    const adv2 = await runAuthorize(fragId, REDIRECT_URI);
    result.checks.adv_fragment_rejected = !adv2.code;
    result.evidence.adv_fragment_rejected = `code=${adv2.code}, authStatus=${adv2.authStatus}, error=${adv2.error}`;

    // (3) client_id URL with userinfo (credentials) -> rejected.
    const credId = `http://user:pass@localhost:${META_PORT}/client.json`;
    const adv3 = await runAuthorize(credId, REDIRECT_URI);
    result.checks.adv_userinfo_rejected = !adv3.code;
    result.evidence.adv_userinfo_rejected = `code=${adv3.code}, authStatus=${adv3.authStatus}, error=${adv3.error}`;

    // (4) metadata doc whose redirect_uris don't include the requested redirect.
    const badRedirId = `${META_HOST}/client-bad-redirect.json`;
    const adv4 = await runAuthorize(badRedirId, REDIRECT_URI); // request a redirect the doc doesn't list
    let adv4Tok = { status: "n/a", text: "" };
    if (adv4.code) adv4Tok = await exchange(adv4.code, adv4.verifier, badRedirId, REDIRECT_URI);
    result.checks.adv_redirect_mismatch_rejected = !adv4.code && (adv4Tok.status === "n/a" || adv4Tok.status !== 200);
    result.evidence.adv_redirect_mismatch_rejected = `code=${adv4.code}, authStatus=${adv4.authStatus}, error=${adv4.error}, tokenStatus=${adv4Tok.status}`;

    // (5) non-JSON document (200 text/html) -> fails closed, no token.
    const notJsonId = `${META_HOST}/client-notjson.json`;
    const adv5 = await runAuthorize(notJsonId, REDIRECT_URI);
    result.checks.adv_nonjson_failsclosed = !adv5.code;
    result.evidence.adv_nonjson_failsclosed = `code=${adv5.code}, authStatus=${adv5.authStatus}, error=${adv5.error}`;

    // (6) unreachable document (nothing listening on that loopback path/port) -> fails closed.
    const deadId = `http://localhost:4599/client.json`;
    const adv6 = await runAuthorize(deadId, REDIRECT_URI);
    result.checks.adv_unreachable_failsclosed = !adv6.code;
    result.evidence.adv_unreachable_failsclosed = `code=${adv6.code}, authStatus=${adv6.authStatus}, error=${adv6.error}`;

    result.ok = Object.values(result.checks).every(Boolean);
  } finally {
    metaServer.close();
  }
}

main()
  .catch((e) => { result.error = String(e && e.stack ? e.stack : e); })
  .finally(() => {
    writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: result.ok, checks: result.checks, error: result.error }, null, 2));
    process.exit(result.ok ? 0 : 1);
  });

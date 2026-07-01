// Notes's OAuth client + OFFLINE token verifier.
//
// This module shares NOTHING with AuthCo except knowledge of its public URLs.
// It never imports AuthCo's code, never reads AuthCo's database, and holds no
// BETTER_AUTH_SECRET or signing key. Token verification is purely asymmetric:
// fetch AuthCo's public JWKS and check the signature. The only secret Notes
// holds is its OWN client_secret, used solely to authenticate itself to the
// token endpoint (its password to AuthCo) — never to verify a token.

import { randomBytes, createHash } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";

const CLIENT_ID = process.env.NOTES_CLIENT_ID;
const CLIENT_SECRET = process.env.NOTES_CLIENT_SECRET;
const AUTHCO = (process.env.AUTHCO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const NOTES_BASE = (process.env.NOTES_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const REDIRECT_URI = `${NOTES_BASE}/callback`;

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---- discovery (only AuthCo's public metadata) ----
let _disc = null;
let _jwks = null;
export async function discover() {
  if (_disc) return _disc;
  const res = await fetch(`${AUTHCO}/api/auth/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
  _disc = await res.json();
  return _disc;
}
async function jwks() {
  const d = await discover();
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(d.jwks_uri));
  return _jwks;
}

export function newPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  return { verifier, challenge, state };
}

export async function buildAuthorizeUrl({ challenge, state, scope = "openid profile email offline_access" }) {
  const d = await discover();
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

function basicAuth() {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

export async function exchangeCode({ code, verifier }) {
  const d = await discover();
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, text };
}

export async function refresh(refreshToken) {
  const d = await discover();
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, text };
}

/**
 * OFFLINE verification: signature via AuthCo's public JWKS, plus issuer,
 * audience (must equal Notes's own client_id) and exp. No DB, no secret.
 * Pass `currentDate` to evaluate expiry at a chosen instant (AC-8).
 * Pass `expect` to override issuer/audience for adversarial checks (AC-6).
 */
export async function verifyIdToken(idToken, { currentDate, expect } = {}) {
  const d = await discover();
  const issuer = expect?.issuer ?? d.issuer;
  const audience = expect?.audience ?? CLIENT_ID;
  const { payload, protectedHeader } = await jwtVerify(idToken, await jwks(), {
    issuer,
    audience,
    ...(currentDate ? { currentDate } : {}),
  });
  return { payload, header: protectedHeader };
}

export const config = { CLIENT_ID, AUTHCO, NOTES_BASE, REDIRECT_URI };

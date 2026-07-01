// Offline access-token verifier for the protected API.
//
// Shares NOTHING with AuthCo but its public URLs. No BETTER_AUTH_SECRET, no DB,
// no AuthCo code. Verification is asymmetric: fetch AuthCo's public JWKS and
// check the RS256 signature, plus issuer, audience (this API's own URL), and exp.
//
// The verifier is PINNED to RS256 (`algorithms: ["RS256"]`): a token signed with
// any other algorithm is rejected before the key is even consulted. That is what
// makes "the issuer's alg must match the consumer's" a real, enforced contract.

import { jwtVerify, createRemoteJWKSet } from "jose";

const AUTH_ISSUER = process.env.AUTH_ISSUER ?? "http://localhost:3000";
const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL ?? "http://localhost:3000/api/auth/jwks";
const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://localhost:8000";

const JWKS = createRemoteJWKSet(new URL(AUTH_JWKS_URL));

export const verifyConfig = { AUTH_ISSUER, AUTH_JWKS_URL, RESOURCE_URL };

/**
 * Verify a bearer access token offline.
 * Enforces: RS256 signature against AuthCo's JWKS, iss == AuthCo, aud == this
 * API's URL (RFC 8707), and exp. Returns the verified payload or throws.
 * `currentDate` lets a test evaluate expiry at a chosen instant (AC-5).
 */
export async function verifyAccessToken(token, { currentDate } = {}) {
  const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
    issuer: AUTH_ISSUER,
    audience: RESOURCE_URL,
    algorithms: ["RS256"],
    ...(currentDate ? { currentDate } : {}),
  });
  return { payload, header: protectedHeader };
}

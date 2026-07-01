// Independent token verifier — the "resource server" side.
//
// This script shares NO state with the issuer beyond the public JWKS URL.
// It does not import the auth config, does not touch the database, and holds
// no signing key or client secret. That independence is the whole point:
// it makes AC-3 / AC-6 / AC-7 real checks, not self-assertions.
//
// Usage (CLI):
//   node scripts/verify-token.mjs <token> <jwksUrl> <issuer> <audience> [isoDate]
// Or import { verifyToken } from this module.

import { jwtVerify, createRemoteJWKSet } from "jose";

const jwksCache = new Map();
function getJwks(jwksUrl) {
  if (!jwksCache.has(jwksUrl)) {
    jwksCache.set(jwksUrl, createRemoteJWKSet(new URL(jwksUrl)));
  }
  return jwksCache.get(jwksUrl);
}

/**
 * Verify a JWT against a remote JWKS, enforcing issuer + audience + exp.
 * @returns {Promise<{ ok: true, payload: object, header: object } | { ok: false, code: string, message: string }>}
 */
export async function verifyToken(token, { jwksUrl, issuer, audience, currentDate } = {}) {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, getJwks(jwksUrl), {
      issuer,
      audience,
      ...(currentDate ? { currentDate } : {}),
    });
    return { ok: true, payload, header: protectedHeader };
  } catch (err) {
    return { ok: false, code: err?.code ?? "ERR", message: err?.message ?? String(err) };
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , token, jwksUrl, issuer, audience, isoDate] = process.argv;
  if (!token || !jwksUrl || !issuer || !audience) {
    console.error("usage: node scripts/verify-token.mjs <token> <jwksUrl> <issuer> <audience> [isoDate]");
    process.exit(2);
  }
  const result = await verifyToken(token, {
    jwksUrl,
    issuer,
    audience,
    currentDate: isoDate ? new Date(isoDate) : undefined,
  });
  if (result.ok) {
    const p = result.payload;
    console.log("VERIFIED");
    console.log("  alg :", result.header.alg);
    console.log("  iss :", p.iss);
    console.log("  aud :", p.aud);
    console.log("  sub :", p.sub);
    console.log("  exp :", p.exp, "(" + new Date(p.exp * 1000).toISOString() + ")");
    process.exit(0);
  } else {
    console.log("REJECTED", result.code, "-", result.message);
    process.exit(1);
  }
}

import { jwtVerify, createRemoteJWKSet } from "jose";
import { NOTES_RESOURCE } from "./notes-resource";

// The resource side. Access tokens minted for this resource are JWTs (typ
// "at+jwt") signed by the issuer, so we verify them OFFLINE against the public
// JWKS — no DB read, no shared secret, no call back into the issuer. Exactly
// the same trust model the spec-02 verifier proved for ID tokens.

const ISSUER = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000") + "/api/auth";
const JWKS = createRemoteJWKSet(new URL(ISSUER + "/jwks"));

export type ScopeCheck =
  | { ok: true; payload: Record<string, unknown>; granted: string[] }
  | { ok: false; status: 401 | 403; error: string };

function extractBearer(req: Request): string | undefined {
  const h = req.headers.get("authorization") ?? "";
  const [scheme, value] = h.split(" ");
  if (scheme?.toLowerCase() === "bearer" && value) return value.trim();
  return undefined;
}

function grantedScopes(payload: Record<string, unknown>): string[] {
  const s = payload.scope;
  if (typeof s === "string") return s.split(/\s+/).filter(Boolean);
  if (Array.isArray(s)) return s as string[];
  return [];
}

/**
 * Enforce that the caller's token is valid AND carries `requiredScope`.
 * - no / garbage / expired / wrong-audience token -> 401 (invalid_token)
 * - genuine token that lacks the scope            -> 403 (insufficient_scope)
 * The scope read here is the token's GRANTED scope claim, never the request's.
 * We refuse before any work is done.
 */
export async function requireScope(req: Request, requiredScope: string): Promise<ScopeCheck> {
  const token = extractBearer(req);
  if (!token) return { ok: false, status: 401, error: "missing_bearer_token" };

  let payload: Record<string, unknown>;
  try {
    // Authenticity, issuer, audience and exp are enforced here. We do NOT pass
    // the required scope to jose, so a genuine-but-under-scoped token reaches
    // the scope check below and yields 403 (not 401).
    const verified = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: NOTES_RESOURCE,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  const granted = grantedScopes(payload);
  if (!granted.includes(requiredScope)) {
    return { ok: false, status: 403, error: "insufficient_scope" };
  }
  return { ok: true, payload, granted };
}

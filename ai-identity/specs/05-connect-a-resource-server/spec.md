# spec.md — Connect a resource server (an API / MCP gateway)

## Goal

Prove your issuer works for a **resource server**, not just a login client. An API or MCP gateway receives a bearer token on each request, validates it offline against your published keys, and trusts the `sub` inside it — never a value from the request body. This is the other half of being an issuer: spec 04 was a _client_ getting an ID token to log a person in; here a _protected API_ checks an access token to authorize a call. The audience model is different, and so is the algorithm a typical verifier expects.

## User Scenarios

- A protected API (or an MCP gateway like the one from the Connector-Native Apps course) gets `Authorization: Bearer <token>`, verifies it against AuthCo's JWKS, and serves the request as the verified user.
- A token minted for a _different_ resource (different `aud`) is refused by this API, even though AuthCo signed it.
- A tampered or expired token is refused.

## Functional Requirements

- FR-1 AuthCo signs tokens the resource server can verify. Most resource-server verifiers (FastMCP `JWTVerifier`, python-`jose`, many gateways) expect **RS256**, while Better Auth's `jwt` plugin defaults to **EdDSA**. Configure the plugin for RS256.
- FR-2 The access token is **audience-bound to the resource server's canonical URL** (RFC 8707): `aud` = the API's `RESOURCE_URL`. This is different from spec 04's ID token, whose `aud` is the client_id.
- FR-3 The token carries `iss` = AuthCo, `sub` = the user, and a finite `exp`.
- FR-4 The resource server validates **offline** using only AuthCo's JWKS (`jwks_uri` / `createRemoteJWKSet`), checking signature, `iss`, `aud`, and `exp`. Identity is taken only from the verified `sub`, never from a tool/request argument.
- FR-5 A way to obtain the token: the `jwt` plugin's `GET /api/auth/token` returns a signed JWT for the current session (the analog of a real authorization server handing a caller a token).

## Edge Cases & Rules

- **Algorithm mismatch is a real failure:** an EdDSA-signed token presented to an RS256-only verifier is rejected. Match the issuer's signing alg to what the consumer accepts.
- A token whose `aud` is not this resource is rejected, even with a valid signature.
- A token past `exp` is rejected offline, without calling back to AuthCo.
- A tampered token (any byte of the signature changed) is rejected.

## Out of Scope (this spec)

- The interactive login UI and ID-token flow (spec 04). Agents and on-behalf-of (roadmap).

## Acceptance Criteria

Functional:

- [ ] AC-1 The resource server accepts a valid AuthCo token and reads `sub`; a request with it succeeds and is attributed to that user.
- [ ] AC-2 Verification is **offline**: only the JWKS URL is used — no shared secret, no read of AuthCo's database.

Adversarial / security (a build can pass AC-1..2 and still fail these):

- [ ] AC-3 **Tampered token → rejected** (401/AuthError), proving the signature is actually checked.
- [ ] AC-4 **Wrong audience → rejected:** a token whose `aud` is not this resource's URL is refused even though AuthCo signed it (RFC 8707).
- [ ] AC-5 **Expired → rejected** offline, with no call back to AuthCo.
- [ ] AC-6 **Algorithm actually matches:** the issuer emits the alg the consumer accepts (RS256 here), demonstrated by a verifier that only accepts RS256 succeeding, and an EdDSA token failing against it.

## Notes for the builder

- Read `.agents/skills/agent-identity-issuer/` sections 1 (issuer) and 3 (resource-server verification).
- **Verified config:**
  ```ts
  jwt({
    jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
    jwt: {
      issuer: process.env.BETTER_AUTH_URL, // = the resource's AUTH_ISSUER
      audience: process.env.RESOURCE_URL, // the protected API's own URL (RFC 8707)
      expirationTime: "1h",
      getSubject: (session) => session.user.id,
    },
  });
  ```
- ⚠️ **Verified gotcha (live-only catch):** Better Auth's docs label the RSA option `"RSA256"`, but `jose` throws `JOSENotSupported` on that value — the alg that actually works is **`"RS256"`**. Using `"RSA256"` makes `/api/auth/token` return 500.
- This is the path we proved live against the Connector-Native Apps gateway: three env edits on the gateway (`AUTH_ISSUER`, `AUTH_JWKS_URL`, enable auth) pointed it at AuthCo, and its `JWTVerifier(jwks_uri, issuer, audience=RESOURCE_URL)` accepted AuthCo's token with zero gateway code changes.
- Keep the resource server a genuinely separate process so AC-2/AC-3 are real.

# spec.md — Connect a real app

## Goal

Prove the issuer works for someone other than you. A **separate** app, "Notes," that shares nothing with AuthCo (no database, no `BETTER_AUTH_SECRET`, no view of anyone's password) registers as an OAuth client, sends a person through AuthCo to sign in, receives a signed token, and verifies it **offline** using only AuthCo's published JWKS. Then it shows the person signed in. This is the whole point of becoming an issuer: a stranger app can trust your tokens without trusting your secrets. The same flow also proves revocation, that a token you pull back actually stops working.

## User Scenarios

- A person clicks "Sign in with AuthCo" inside Notes, authenticates and consents at AuthCo, and lands back in Notes shown as signed in (their name/email from the verified token).
- Notes verifies the token by fetching AuthCo's JWKS over HTTP and checking the signature, issuer, audience, and expiry, with no shared secret and no call into AuthCo's database.
- An operator revokes the client (or its token) at AuthCo; Notes's very next protected call fails.

## Functional Requirements

- FR-1 Notes runs as a **separate process** from AuthCo. It holds only its own OAuth client credentials (`client_id` + `client_secret`) and AuthCo's public URLs. It has no access to AuthCo's DB and no copy of `BETTER_AUTH_SECRET`.
- FR-2 Notes is a registered OAuth client with a fixed `redirect_uri` (its callback) and a known, stable `client_id`.
- FR-3 The full **authorization-code + PKCE** flow runs against AuthCo: authorize → consent → callback with `code` → token exchange at `/oauth2/token` using Notes's own credentials and the PKCE `code_verifier`.
- FR-4 Notes verifies the returned ID token **offline** with `jose` against AuthCo's JWKS (`createRemoteJWKSet` + `jwtVerify`), enforcing `issuer`, `audience`, and `exp`. No symmetric secret, no DB read.
- FR-5 On a verified token, Notes establishes its own signed-in view (its own session/page) showing the person's identity from the token claims.
- FR-6 Revocation works: after AuthCo revokes the client or the token (`/api/auth/oauth2/revoke`, or disabling the client row), the next protected call Notes makes (token exchange, refresh, or userinfo) fails rather than succeeding.

## Edge Cases & Rules

- Notes must never receive or store the user's AuthCo password. It only ever sees a `code`, then tokens.
- A token whose `aud` is not Notes's `client_id`, or whose `iss` is not AuthCo, is rejected by Notes's verifier.
- A reused authorization code yields no second token.
- A token past `exp` is rejected by the offline verifier.
- If AuthCo's JWKS rotates keys, Notes picks up the new key from the JWKS URL without any code change (no pinned key material).

## Out of Scope (this spec)

- An agent's own credential, on-behalf-of authority, two-factor (half 2 / roadmap).
- Production hardening of Notes (rate limits, refresh rotation policy) beyond what the criteria require.

## Acceptance Criteria

Functional:

- [ ] AC-1 Notes completes authorize → consent → token exchange against AuthCo and obtains a signed ID token.
- [ ] AC-2 Notes verifies that token offline via JWKS and reads `sub`/`aud`/`iss`/`exp`; the page then shows the person signed in.
- [ ] AC-3 The `aud` on the token equals Notes's `client_id` and `iss` equals AuthCo's issuer URL.

Adversarial / security (a build can pass AC-1..3 and still fail these):

- [ ] AC-4 **Offline, secretless verification:** Notes verifies using only the JWKS URL. With the JWKS fetch blocked it cannot verify; with no AuthCo DB access and no `BETTER_AUTH_SECRET`, it still can. (Prove the negative: there is no shared symmetric secret anywhere in Notes.)
- [ ] AC-5 **Revocation bites immediately:** after revoking the client/token at AuthCo, Notes's next protected call (refresh/userinfo/exchange) fails; it does not keep working on a cached success.
- [ ] AC-6 **Wrong audience/issuer rejected:** a token minted for a different `aud`, or carrying a different `iss`, is rejected by Notes's verifier (`ERR_JWT_CLAIM_VALIDATION_FAILED` or equivalent), not accepted.
- [ ] AC-7 **Password never crosses the boundary:** across the whole flow, no Notes-side log or response body contains the user's AuthCo password or any password hash. Notes only ever holds a `code` and tokens.
- [ ] AC-8 **Expiry enforced offline:** a token advanced past its `exp` is rejected by Notes's verifier without any call back to AuthCo.

## Notes for the builder

- Read `.agents/skills/agent-identity-issuer/` first, sections 2 (register a client) and 3 (verify a token as a resource server).
- **Client registration caveat (verified):** `auth.api.createOAuthClient` is **session-gated** and mints a **random** `client_id`, which is wrong when a separate app needs a stable, known id up front. For a fixed-id connector, insert a row in the `oauthClient` table with the secret stored as `base64url(SHA-256(secret))` (unpadded, the plugin's hashed default); array columns (`redirectUris`, `scopes`, `grantTypes`, `responseTypes`) are JSON text; set `tokenEndpointAuthMethod: "client_secret_basic"`.
- **Consent flow (verified):** `/oauth2/authorize` redirects to `/consent` with a **signed `oauth_query`** string (not a `consent_code`); the consent page hands the whole string back to `/api/auth/oauth2/consent` as `{ accept: true, oauth_query }`. Sending `sec-fetch-mode: cors` makes authorize and consent return `{ redirect, url }` JSON instead of a raw 302, which is simpler to drive from Notes.
- Verify with `jose`: `createRemoteJWKSet(new URL(jwks_uri))` then `jwtVerify(idToken, JWKS, { issuer, audience: client_id })`. `jose` enforces `exp`; advance `currentDate` past `exp` to prove AC-8 without waiting.
- Keep AuthCo and Notes as genuinely separate processes/dirs so AC-4 and AC-7 are real. Notes must never import AuthCo's auth instance or read its DB.
- For revocation (AC-5), call `/api/auth/oauth2/revoke` (or disable the client row), then make the next call and confirm it fails, do not assume it.
- Map each acceptance criterion to a check (script or manual run-through) and run it before calling this done.

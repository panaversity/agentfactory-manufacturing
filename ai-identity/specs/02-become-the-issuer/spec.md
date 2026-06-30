# spec.md — Become the issuer

## Goal

Turn AuthCo into an **issuer**: when another app asks, your server hands back a signed token that the other app can verify entirely on its own, using your published public keys — without ever seeing a password or calling into your database. You stop being the bartender who only checks the wristband and become the booth that prints it.

## User Scenarios

- A registered client app sends a person to AuthCo to sign in; after they approve, the client receives a signed ID token identifying that person.
- The client verifies that token using only AuthCo's published keys (JWKS) — offline from AuthCo's database.
- A token carries who issued it, who it's for, and when it expires; past expiry it is rejected.

## Functional Requirements

- FR-1 The `jwt` plugin is enabled: an asymmetric signing key (EdDSA/Ed25519) and a public JWKS endpoint.
- FR-2 The `@better-auth/oauth-provider` plugin makes AuthCo an OIDC/OAuth issuer: a discovery document, the authorization-code flow with **PKCE required**, and token + userinfo endpoints. `loginPage: "/sign-in"`, `consentPage: "/consent"`.
- FR-3 Client secrets are stored hashed at rest (the plugin default `storeClientSecret: "hashed"` — keep it).
- FR-4 At least one registered OAuth client exists so the flow can be exercised end to end.
- FR-5 An ID token is a JWT signed with the JWKS key and carries `iss`, `aud`, and a finite `exp`.

## Edge Cases & Rules

- A reused or expired authorization code → no token is issued.
- A client requesting a scope it was not registered for → denied.
- A missing or malformed token at a protected resource → 401, not 200.

## Out of Scope (this spec)

- Fine-grained scope enforcement and the consent UI polish (spec 03), connecting an external app end-to-end (spec 04), agents (half 2).

## Acceptance Criteria

Functional:

- [ ] AC-1 The discovery doc (`/api/auth/.well-known/openid-configuration`) and JWKS (`/api/auth/jwks`) both return valid JSON; JWKS has at least one public key.
- [ ] AC-2 A registered client completes the authorization-code + PKCE flow and receives a signed ID token (alg present, three JWT parts).
- [ ] AC-3 The ID token verifies against the JWKS, and its `sub`/`aud`/`iss`/`exp` read correctly.

Adversarial / security (the ones that matter):

- [ ] AC-4 **JWKS is public-only:** the key set exposes public parameters only — no `d`/`p`/`q`/private material is reachable over HTTP.
- [ ] AC-5 **No secret leaks:** across the whole flow, no signing key, client secret, or `BETTER_AUTH_SECRET` appears in logs or any response body.
- [ ] AC-6 **Tokens expire:** a token past its `exp` is rejected by a compliant verifier (e.g. `ERR_JWT_EXPIRED`), not accepted.
- [ ] AC-7 **Issuer & audience enforced:** a token minted for a different `aud`, or a different `iss`, is rejected by the verifier.
- [ ] AC-8 **Auth code is single-use:** replaying a used authorization code yields no second token (`invalid_grant`).
- [ ] AC-9 **Client secret hashed at rest:** the stored client secret is a hash, never the plaintext.

## Notes for the builder

- Read `.agents/skills/agent-identity-issuer/` first — it has the verified `oauthProvider` config, the real endpoint paths, the **signed `oauth_query` consent flow** (not a `consent_code`), and the client-registration caveat (`createOAuthClient` is session-gated and mints a random id; for a fixed-id client use a DB row with `base64url(SHA-256(secret))`).
- Build the verifier as a genuinely independent step (a small script using `jose` + the JWKS URL) so AC-3/AC-6/AC-7 are real, not self-asserted.

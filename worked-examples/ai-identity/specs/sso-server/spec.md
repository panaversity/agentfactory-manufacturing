# spec.md — AuthCo SSO Server (become the issuer)

## Goal

Stand up our own identity service so we stop renting login and start **issuing** it.
A person signs in with email and password; our server holds the session and, when another
app asks, issues a signed token that the other app can verify on its own — without ever
calling back to us with a shared password. We become the booth that prints the wristband,
not the bartender who only checks it.

## User Scenarios

- A new person signs up with email + password, then signs in and gets a session.
- A signed-in person visits a **separate** app ("Notes"), clicks "Sign in with AuthCo",
  approves the request on AuthCo's consent screen, and lands back in Notes signed in —
  Notes never saw their password.
- Notes verifies the person's token entirely on its own, using AuthCo's published keys.
- A token expires; after expiry the person must sign in again. A revoked client can no
  longer get anyone signed in.

## Functional Requirements

- FR-1 Email/password sign-up, sign-in, sign-out, and server-side sessions (Better Auth core).
- FR-2 The server is an **OIDC provider**: it exposes a discovery document and a JWKS
  (public keys) endpoint, and runs the OAuth 2.0 **authorization-code** flow.
- FR-3 A registered OAuth client (the "Notes" app) can complete the code flow and receive
  an ID token + access token. The ID token is a JWT signed by AuthCo's key.
- FR-4 A consent step: the person explicitly approves what the client is asking for before
  any token is issued.
- FR-5 Tokens carry an issuer, an audience (the client), an expiry, and the granted scopes.
- FR-6 A second, independent process (Notes) validates an issued token using ONLY the JWKS
  endpoint — no shared secret, no callback to AuthCo's database.

## Edge Cases & Rules

- Wrong password, unknown email, or reused/expired auth code → request is rejected, no token issued.
- A client asking for a scope it was not registered for → denied.
- Missing or malformed token at a protected resource → 401, not 200.
- Time skew: token `exp` is honoured; an expired token is rejected even if otherwise valid.

## Out of Scope (this spec)

- Two-factor, social login, agent/on-behalf-of credentials, human-approval gates on actions.
  (Those are later specs. Build only the issuer here.)

## Acceptance Criteria

Functional:
- [ ] AC-1 `curl` sign-up then sign-in returns a session; a protected route returns 200 with it, 401 without.
- [ ] AC-2 The discovery doc and JWKS endpoints both return valid JSON; JWKS contains at least one public key.
- [ ] AC-3 The Notes client completes the authorization-code flow and receives a signed ID token.
- [ ] AC-4 Notes verifies that ID token using only the JWKS (offline from AuthCo's DB) and reads the subject.

Adversarial / security (these are the ones that matter — a build can pass AC-1..4 and still fail these):
- [ ] AC-5 **No secret leaks:** grep the server logs and every HTTP response body across the whole flow —
      no `BETTER_AUTH_SECRET`, no client secret, no private signing key, no password or password hash appears.
- [ ] AC-6 **Tokens expire:** an ID/access token past its `exp` is rejected at the resource (401), not accepted.
- [ ] AC-7 **Private keys never served:** the JWKS endpoint exposes public keys only; no private key material is reachable over HTTP.
- [ ] AC-8 **Audience/issuer enforced:** a token minted for a different audience or issuer is rejected by Notes, not accepted.
- [ ] AC-9 **Auth code is single-use:** replaying a used authorization code does not yield a second token.
- [ ] AC-10 **Password safety:** no endpoint returns the password or its hash; the user record over the wire omits credential fields.

## Notes for the builder

- Use the Better Auth `oidc-provider` and `jwt` plugins (`better-auth/plugins/oidc-provider`, `better-auth/plugins/jwt`). Read those skills/docs first.
- Keep AuthCo and the Notes consumer as clearly separate pieces so AC-4/AC-6/AC-8 can be tested truly independently.
- Every acceptance criterion above should map to a check in `./verify.sh`.

---
name: agent-identity-issuer
description: Make a Better Auth app an OIDC/OAuth issuer (it signs tokens other apps verify) and give an AI agent its own bounded, on-behalf-of credential. Use when configuring @better-auth/oauth-provider, the jwt/JWKS plugin, OAuth client registration, the consent flow, resource-server token verification, or @better-auth/agent-auth. The official better-auth-* skills do NOT cover token issuance or agent identity — this one does, with config verified against Better Auth 1.6.x.
---

# Issuer & Agent Identity (Better Auth)

The official `better-auth-*` skills cover authenticating _your own_ users (email/password, sessions, 2FA, security). They do **not** cover making your app an **issuer** (signing tokens other apps trust) or giving an **agent** its own identity. That is this skill. Every snippet below is verified against Better Auth 1.6.x and `@better-auth/oauth-provider`; paste the config, do not reconstruct it from memory.

## 1. Become an OIDC/OAuth issuer

Install: `pnpm add @better-auth/oauth-provider` (the `jwt` plugin is in core `better-auth`).

```ts
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
  appName: "AuthCo",
  // database adapter of your choice (Neon Postgres in this base)
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  plugins: [
    jwt(), // asymmetric signing key (EdDSA/Ed25519) + public /jwks
    oauthProvider({
      loginPage: "/sign-in", // where the browser is sent to authenticate
      consentPage: "/consent", // where the user approves the client's request
      scopes: ["openid", "profile", "email", "offline_access"],
      // storeClientSecret defaults to "hashed" — KEEP IT. Client secrets are stored
      // as base64url(SHA-256(secret)); never recoverable in plaintext at rest.
      // PKCE is required by default (OAuth 2.1). No flag needed.
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
    }),
    nextCookies(), // MUST be last (bridges Set-Cookie into Next's cookie store)
  ],
});
```

Mount everything with one catch-all route: `src/app/api/auth/[...all]/route.ts` → `export const { GET, POST } = toNextJsHandler(auth)`.

### Endpoints it exposes (under the handler base `/api/auth`)

- Discovery: `/api/auth/.well-known/openid-configuration`
- Public keys: `/api/auth/jwks` ← public params only; private key is never served
- `/api/auth/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo`, `/oauth2/consent`, `/oauth2/introspect`, `/oauth2/revoke`, `/oauth2/register`

### The consent flow has changed (verified gotcha)

`oauthProvider` does **not** use a short `consent_code`. `/oauth2/authorize` redirects to your `consentPage` with a **signed `oauth_query`** string; the consent page POSTs that whole string back to `/api/auth/oauth2/consent` as `{ accept: true, oauth_query }`. To JSON callers (send `sec-fetch-mode: cors`), both authorize and consent return `{ redirect, url }` instead of a raw 302 — useful for headless/scripted flows.

## 2. Register a client (two ways)

- **Self-service (recommended for real apps):** `auth.api.createOAuthClient({ headers, body: { redirect_uris, token_endpoint_auth_method } })`. Caveat: it requires a **logged-in session** and **auto-generates a random `client_id`** — great for signup, wrong when a separate app needs a _stable, known_ id up front.
- **Deterministic (fixed id/secret, e.g. a demo connector):** insert a row in the `oauthClient` table. The secret column must hold the same hash the plugin uses: `base64url(SHA-256(secret))`, unpadded. Array columns (`redirectUris`, `scopes`, `grantTypes`, `responseTypes`) are stored as JSON text. Set `tokenEndpointAuthMethod: "client_secret_basic"`.
- Dynamic registration (`allowDynamicClientRegistration: true`) exposes `/oauth2/register` (RFC 7591) for clients that self-enroll.

### The durable question: how does a client prove who it is? (manual → DCR → CIMD)

The mechanism here is actively churning; the _primitive_ is not. Teach the question, treat each mechanism as one instantiation:

1. **Manual / static** — a fixed `client_id` you pre-register (a DB row, as above). Stable, production-fine, what this base uses by default.
2. **DCR (Dynamic Client Registration, RFC 7591)** — the client POSTs to `/oauth2/register`, the server creates a record and returns a generated id/secret. Better Auth supports this. **In MCP it is now being deprecated** (kept for back-compat): it burdens the authorization server and is open to client-impersonation/spam.
3. **CIMD (Client ID Metadata Documents)** — the `client_id` _is_ an `https` URL hosting a JSON metadata document; the server fetches that URL instead of keeping a record. No pre-registration. This is the **new preferred direction**: the MCP `2026-07-28` spec recommends it and deprecates DCR.

⚠️ **Edge status (verify before relying — moves fast):** CIMD is an IETF _draft_ (`draft-ietf-oauth-client-id-metadata-document`, WG-adopted, not yet an RFC). **Better Auth DOES implement it** — the `@better-auth/cimd` plugin (PR #9159, merged 2026-04-13): add `cimd()`, or pass `cimdClientDiscovery()` to `oauthProvider({ clientDiscovery })`; it advertises `client_id_metadata_document_supported` in discovery and resolves URL-shaped `client_id`s (HTTPS-URL → fetched JSON metadata doc, no pre-registration). The catch: it ships only in the **v1.7.0 pre-release** line (`@better-auth/cimd@1.7.0-rc.0` / `-beta`), while **stable is `1.6.23` and is DCR-only**. So pinned to stable you have static + DCR today; CIMD is a real, runnable upgrade once you move to the 1.7.0 rc/beta channel — a great edge project, not just a concept. FastMCP-side CIMD support is still an open issue (SEP-991). Re-check versions at ship time.

## 3. Verify a token as a resource server (the consumer side)

A consumer validates an issued token **offline**, using only the JWKS — no shared secret, no call into the issuer's database:

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";
const JWKS = createRemoteJWKSet(new URL("http://localhost:3000/api/auth/jwks"));
const { payload } = await jwtVerify(idToken, JWKS, {
  issuer: "http://localhost:3000", // reject a token minted by anyone else
  audience: "your-client-id", // reject a token minted for a different app
});
// `exp` is enforced by jose; an expired token throws ERR_JWT_EXPIRED.
```

Or use the typed helper: `oauthProviderResourceClient(auth)` from `@better-auth/oauth-provider/resource-client`.

Client-side (the issuer app's own browser code): `oauthProviderClient()` from `@better-auth/oauth-provider/client`, added to `createAuthClient`.

## 4. Give an agent its own identity (half 2 — `@better-auth/agent-auth`, BETA)

`@better-auth/agent-auth` is **experimental** (the standard is still moving — say so to the reader). It maps directly onto the durable primitives:

```ts
import { agentAuth } from "@better-auth/agent-auth";
agentAuth({
  providerName: "AuthCo",
  modes: ["delegated", "autonomous"], // delegated = act for a user; autonomous = its own synthetic user
  capabilities: [
    /* named actions, optionally with JSON-Schema input = scopes */
  ],
  approvalMethods: ["device_authorization", "ciba"], // human-in-the-loop approval
  async onExecute({ capability, arguments: args, agentSession }) {
    /* do the work */
  },
});
```

- The agent discovers the provider at `/.well-known/agent-configuration`, registers, requests capability grants; the **user approves** (device flow or CIBA); the server issues **short-lived JWTs** whose `aud` matches the URL being called, carry a `capabilities` claim, and a `jti` for replay protection.
- Verify outside `onExecute`: `verifyAgentRequest(request, auth)` or `auth.api.getAgentSession({ headers })` → `{ user, agent (with capabilityGrants), host }`.
- Teach this as **one swappable instantiation** of the primitives (own credential, on-behalf-of, least-privilege scope, human approval, revocable), not as the final standard.

## Invariants to enforce while building

- Keep `storeClientSecret` at its hashed default; never store a client secret in plaintext.
- Never serve or log a private signing key — only `/jwks` (public) is reachable.
- Every issued token carries `iss`, `aud`, and a finite `exp`; resource servers must check all three.
- A revoked client/token must actually fail the next call — verify via `/oauth2/revoke` + a follow-up request, don't assume.

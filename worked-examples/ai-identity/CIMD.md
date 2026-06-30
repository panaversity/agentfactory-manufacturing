# CIMD — wired and proven (spec `06-client-identity-with-cimd`)

> **The answer key for spec 06.** This worked solution runs on the **Better Auth `1.7.0-rc.0`** pre-release stack, and CIMD is not just documented here — it is wired into `src/lib/auth.ts` and **proven**: `cimd-verify.sh` passes 10/10 (happy path + six adversarial checks). `allowLoopback: true` makes it testable locally over plain `http://localhost`. It is still a pre-release on a draft standard, so pin the versions you land on and re-confirm the surface against the live Better Auth docs MCP (`https://mcp.better-auth.com/mcp`) at ship time.

## What CIMD changes

With a fixed `client_id`, a client proves who it is by matching a record you keep (a row, or a DCR registration). With **CIMD (Client ID Metadata Documents)**, the `client_id` _is_ an `https` URL that hosts a JSON metadata document. Your issuer fetches that URL and reads the document instead of keeping a record. No pre-registration. The `client_id` carries its own metadata with it.

It is the direction the MCP world is moving: the MCP `2026-07-28` spec recommends CIMD and deprecates DCR. The standard itself is an IETF **draft** (`draft-ietf-oauth-client-id-metadata-document`, WG-adopted, not yet an RFC), which is why this is the edge of the course — real and runnable, but pre-release.

## 1. The stack (pinned)

CIMD ships on the 1.7 pre-release line. The exact versions this build is proven on:

```jsonc
// package.json
"better-auth": "1.7.0-rc.0",
"@better-auth/oauth-provider": "1.7.0-rc.0",
"@better-auth/cimd": "1.7.0-rc.0",
// peer that the resolved tree pins:
"better-call": "1.3.7",
// REQUIRED override — see gotcha #1 below:
"pnpm": { "overrides": { "kysely": "0.28.17" } }
```

Pin the exact versions you land on. This is pre-release: betas can move the surface between releases.

## 2. How it is wired (the proven shape)

`cimd()` is a Better Auth **plugin**, not an `oauthProvider` option. In its `init()` it calls `extendOAuthProvider(ctx, { clientDiscovery })` to register URL-`client_id` discovery on the provider — so it **must be listed AFTER `oauthProvider()`** in the plugins array. This is the path this build uses:

```ts
// src/lib/auth.ts (excerpt)
import { oauthProvider } from "@better-auth/oauth-provider";
import { cimd } from "@better-auth/cimd";

export const auth = betterAuth({
  // ...email/password, database, jwt() as before...
  plugins: [
    jwt({ jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } } }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      scopes: ["openid", "profile", "email", "offline_access"],
    }),
    // CIMD — listed AFTER oauthProvider (it extends it in init()).
    // allowLoopback lets an http://localhost/client.json client_id work for
    // local testing. Off-loopback, HTTPS is strictly enforced.
    cimd({ allowLoopback: true }),
    nextCookies(), // still last
  ],
});
```

**Equivalent alternative:** pass the discovery into the provider directly via its `extensions` array (note: `extensions`, not a top-level `clientDiscovery`):

```ts
import { cimdClientDiscovery } from "@better-auth/cimd";
oauthProvider({
  // ...
  extensions: [{ clientDiscovery: cimdClientDiscovery() }],
});
```

Use **one** of the two, not both. Useful `cimd()` options: `refreshRate`, `originBoundFields`, `allowLoopback` (default `false` — set `true` for local http loopback testing), `allowFetch`. CIMD only changes how a client is _identified_; the `jwt` signing config and offline JWKS verification from specs 02 and 05 are untouched.

### `allowLoopback` answers the key question

Yes, CIMD **is** testable locally. With `allowLoopback: true` the issuer accepts a loopback `http://localhost:.../client.json` `client_id` for development. Off-loopback, plain `http` (and any non-`https` scheme) is refused before any fetch. That is why `cimd-verify.sh` can host its metadata document over loopback HTTP and still exercise the real code path.

## 3. What changes in discovery

Once CIMD is on, the issuer advertises it. Fetch the discovery document (served at the **issuer root** on 1.7, see gotcha #2) and you will see the capability flag:

```bash
curl -s http://localhost:3000/.well-known/openid-configuration | jq .client_id_metadata_document_supported
# true
```

That one line is the whole contract: it tells any client "you may identify yourself by URL." From there, an authorization-code flow can use an HTTPS-URL `client_id` (e.g. `https://app.example.com/oauth-client.json`); AuthCo fetches that document, checks the requested `redirect_uri` against the document's own `redirect_uris`, and proceeds as a public client (`token_endpoint_auth_method: "none"`, PKCE).

### The cache-row nuance (reality, not the draft's "no row")

The draft talks as if a URL client leaves **no** record. This implementation is more precise: CIMD persists a **cache row** for the URL client — an auto-created **public** client (`public = 1`, `clientSecret = NULL`, `clientId` = the URL itself). It is _not_ a seeded confidential client and it is _not_ "no DB row." `cimd-verify.sh` checks exactly this (CIMD-3): a public, secret-less row keyed by the URL. Knowing this prevents the false expectation that the `oauthClient` table stays empty.

## 4. The two 1.7 migration gotchas

Moving onto 1.7 surfaces two traps this build already fixes:

1. **Pin `kysely` to `0.28.17`.** kysely `0.29` removed the `DEFAULT_MIGRATION_TABLE` runtime barrel export that Better Auth's migrator imports. Without the pnpm override, the migration breaks and every `/api/auth/*` route 500s.

2. **OIDC discovery moved to the issuer root.** In 1.7 the discovery endpoints are `SERVER_ONLY` — no longer exposed under `/api/auth`. Two thin Next route handlers forward the issuer-root paths to `auth.handler` so the plugin's `onRequest` hook can answer them:
   - `src/app/.well-known/openid-configuration/route.ts`
   - `src/app/.well-known/oauth-authorization-server/route.ts`

   JWKS stays at `/api/auth/jwks`. (Minor, flagged not chased: `/oauth2/userinfo` returns 401 even with a valid token on `rc.0`.)

## 5. Verify the exact current surface against the live MCP

This is proven on `1.7.0-rc.0`, but it is still pre-release on a draft standard. Re-confirm before you rely on it:

> Connect to the Better Auth docs MCP at `https://mcp.better-auth.com/mcp` and pull the current `@better-auth/cimd` reference. Confirm: the package versions on the 1.7 channel, that `cimd()` is listed after `oauthProvider()` (or that `cimdClientDiscovery()` goes in `oauthProvider({ extensions: [...] })`), the `allowLoopback` option, and that discovery still advertises `client_id_metadata_document_supported`. Flag anything that differs.

Build from what the MCP returns. If a release moves an import path or renames an option, keep the behavior the spec asks for (URL `client_id` resolved by fetch, the discovery flag advertised, the draft's URL rules enforced, fail-closed on bad documents) and re-map the calls.

## Why it is wired here now

Earlier this file documented CIMD as an unproven upgrade and the rest of the build pinned stable `1.6.23`. That is no longer true. The whole solution moved to `1.7.0-rc.0`, CIMD is wired into `src/lib/auth.ts`, and `cimd-verify.sh` proves it end to end. The honest shape of an edge feature is now: pinned, runnable, proven on this release, and clearly marked as pre-release so you re-check versions at ship time.

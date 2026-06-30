# CIMD — the edge upgrade (documented, not the default build)

> **Read this as the answer key for spec `06-client-identity-with-cimd`.** The rest of this worked example pins **stable Better Auth `1.6.23`**, where a client is identified either by a fixed `client_id` (a seeded DB row, `scripts/seed-client.mjs`) or by DCR. That is the default build. CIMD lives on the **v1.7.0 pre-release** channel, so it is documented here as the upgrade path you take when you do spec 06, not wired into the shipped reference. Everything below was demonstrated against the **live Better Auth docs MCP** (`https://mcp.better-auth.com/mcp`), and because the surface is pre-release, you should re-confirm it the same way before you build.

## What CIMD changes

With a fixed `client_id`, a client proves who it is by matching a record you keep (a row, or a DCR registration). With **CIMD (Client ID Metadata Documents)**, the `client_id` _is_ an `https` URL that hosts a JSON metadata document. Your issuer fetches that URL and reads the document instead of keeping a record. No pre-registration. The `client_id` carries its own metadata with it.

It is the direction the MCP world is moving: the MCP `2026-07-28` spec recommends CIMD and deprecates DCR. The standard itself is an IETF **draft** (`draft-ietf-oauth-client-id-metadata-document`, WG-adopted, not yet an RFC), which is exactly why this is the edge of the course.

## 1. Move to the 1.7 pre-release channel

Stable `better-auth` (1.6.23) does not ship CIMD. The plugin is `@better-auth/cimd`, part of the **v1.7.0 pre-release** line (`@better-auth/cimd@1.7.0-rc.0`, latest beta `1.7.0-beta.10`). So the first move is onto the rc/beta channel:

```bash
# move the core to the 1.7 pre-release line, then add the CIMD plugin
pnpm add better-auth@1.7 @better-auth/oauth-provider@1.7
pnpm add @better-auth/cimd@rc      # or pin a specific beta, e.g. @1.7.0-beta.10
```

Pin the exact versions you land on. This is pre-release: betas can move the surface between releases.

## 2. Wire the issuer

In the pre-release surface there are two equivalent ways to turn CIMD on. Confirm the current shape against the MCP (next section) before pasting:

```ts
// src/lib/auth.ts — add CIMD to the issuer you built in spec 02
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { cimd, cimdClientDiscovery } from "@better-auth/cimd";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
  appName: "AuthCo",
  // ...email/password, database adapter as before...
  plugins: [
    jwt({ jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } } }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      scopes: ["openid", "profile", "email", "offline_access"],
      // Option A: hand client discovery to the oauth provider
      clientDiscovery: cimdClientDiscovery(),
    }),
    // Option B (equivalent): add the plugin alongside oauthProvider
    cimd(),
    nextCookies(), // still last
  ],
});
```

Use **one** of the two options, not both. CIMD only changes how a client is _identified_; the `jwt` signing config and offline JWKS verification from specs 02 and 05 are untouched.

## 3. What changes in discovery

Once CIMD is on, the issuer advertises it. Fetch the discovery document and you will see the new capability flag:

```bash
curl -s http://localhost:3000/api/auth/.well-known/openid-configuration | jq .client_id_metadata_document_supported
# true
```

That one line is the whole contract: it tells any client "you may identify yourself by URL." From there, an authorization-code flow can use an HTTPS-URL `client_id` (e.g. `https://app.example.com/oauth-client.json`); AuthCo fetches that document, checks the requested `redirect_uri` against the document's own `redirect_uris`, and proceeds with **no** `oauthClient` row. A non-HTTPS URL, a URL with a fragment or userinfo, or a document that disagrees with the request is refused per the draft's URL rules.

## 4. Verify the exact current surface against the live MCP

Because this is pre-release, do not trust the snippet above blind — confirm it. The Better Auth docs MCP is the live source:

> Connect to the Better Auth docs MCP at `https://mcp.better-auth.com/mcp` and pull the current `@better-auth/cimd` reference. Confirm: the package version on the 1.7 channel, whether I add `cimd()` or pass `cimdClientDiscovery()` to `oauthProvider({ clientDiscovery })` (or both), and the exact discovery key it advertises. Show me the import paths it returns, and flag anything that differs from `client_id_metadata_document_supported`.

Build from what the MCP returns. If a beta has moved the import path or renamed the option, keep the behavior the spec asks for (URL `client_id` resolved by fetch, the discovery flag advertised, the draft's URL rules enforced) and re-map the calls.

## Why it is documented and not shipped here

The reference build has to run for a reader on a clean clone with zero surprises, so it pins stable `1.6.23` and the static/DCR client path. CIMD asks you to move the whole project onto a pre-release channel — a real, runnable upgrade, but one you opt into when you do spec 06, not a default you inherit. That is the honest shape of an edge feature: documented, reproducible, and clearly marked as off the stable line.

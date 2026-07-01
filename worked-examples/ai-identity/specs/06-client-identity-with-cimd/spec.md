# spec.md — Client identity with CIMD

> **Core, but edge.** This is the last spec on the core spine, and it is the one that steps off stable ground. It runs on Better Auth's **v1.7.0 pre-release** line and an IETF **draft** standard. It is no longer "pre-release unknown": the wiring below is **pinned and proven on `1.7.0-rc.0`** (the reference solution passes `cimd-verify.sh` 10/10, including six adversarial checks). The base already ships on this line. It is still pre-release on a draft standard, so pin the versions you land on and re-confirm the API against the live Better Auth docs MCP (`https://mcp.better-auth.com/mcp`) at ship time.

## Goal

Stop pre-registering clients. So far a client proved who it was with a fixed `client_id` you minted ahead of time (a DB row, spec 02). Here a client identifies itself **by URL**: its `client_id` is an `https` address that hosts a JSON metadata document, and your issuer fetches that document on demand instead of keeping a record. No pre-registration, no DB row, no shared setup step. This is the durable answer to "how does a client prove who it is" that the MCP world is moving toward (CIMD), and it is one spec past the manual/DCR mechanisms you already have.

## User Scenarios

- A client whose `client_id` is an HTTPS URL (e.g. `https://app.example.com/oauth-client.json`) starts an authorization-code flow; AuthCo fetches that URL, reads the metadata document, and proceeds with no prior registration.
- A developer inspects AuthCo's discovery document and sees `client_id_metadata_document_supported: true` advertised next to the existing capabilities.
- A client presents a `client_id` URL that is not HTTPS, or carries a fragment, or embeds userinfo — AuthCo refuses it before fetching anything.

## Functional Requirements

- FR-1 Add CIMD support on the Better Auth **v1.7.0** line. The proven wiring is the `cimd()` plugin listed **after** `oauthProvider()` (it calls `extendOAuthProvider` in its `init()`, so order matters); set `cimd({ allowLoopback: true })` so a loopback `http://localhost/...client.json` `client_id` works for local testing. The equivalent alternative is passing `cimdClientDiscovery()` via `oauthProvider({ extensions: [{ clientDiscovery }] })` — note `extensions`, not a top-level `clientDiscovery`. Re-confirm the import paths and call shape against the live Better Auth docs MCP (`https://mcp.better-auth.com/mcp`) at ship time — this is still pre-release.
- FR-2 Discovery advertises the capability: AuthCo's `/.well-known/openid-configuration` (served at the **issuer root** on 1.7 — see Notes) now includes `client_id_metadata_document_supported: true`.
- FR-3 A URL-shaped `client_id` is resolved by **fetching its metadata document**, not by a seeded record. An HTTPS-URL `client_id` whose JSON metadata document is reachable lets the flow proceed with no pre-registered (confidential) client. Note the proven reality: CIMD auto-creates a **public cache row** for the URL (`public = 1`, `clientSecret = NULL`, `clientId` = the URL) — it is not "no DB row," it is a cached public client distinct from a seeded confidential one.
- FR-4 The existing static/DCR clients still work. Turning on CIMD adds URL clients; it does not remove the fixed-`client_id` path from spec 02.
- FR-5 The fetched metadata document governs the request: the `redirect_uri` the client asks for must be one listed in its own metadata document, exactly as a registered client's stored `redirect_uris` would.

## Edge Cases & Rules

- A `client_id` URL that is **not HTTPS** (plain `http`, or any non-`https` scheme) → rejected, per the draft's URL rules. No metadata fetch.
- A `client_id` URL that carries a **fragment** (`#...`) or **userinfo** (`user:pass@`) → rejected. The identifier must be a clean HTTPS URL.
- A metadata document whose **contents don't match the request** (e.g. the requested `redirect_uri` is not in the document's `redirect_uris`, or the document's `client_id` field disagrees with the URL it was fetched from) → the flow is refused.
- The metadata document is unreachable, non-JSON, or times out → no client is resolved; the flow fails closed, not open.

## Out of Scope (this spec)

- DCR (already supported on stable) and the manual fixed-id client (spec 02) — CIMD is an addition, not a replacement.
- Agent identity and on-behalf-of (`specs/projects/`, the frontier half).
- Hosting the client's own metadata document in production (the consumer side); a local/test document is enough to prove the issuer resolves it.

## Acceptance Criteria

Functional:

- [ ] AC-1 Discovery advertises CIMD: AuthCo's discovery metadata returns `client_id_metadata_document_supported: true`.
- [ ] AC-2 A URL `client_id` is **resolved by fetch, not by a seeded record**: an authorization-code flow with an HTTPS-URL `client_id` completes after AuthCo fetches the metadata document, with no pre-registered confidential client. (CIMD does persist a **public cache row** keyed by the URL — `public = 1`, `clientSecret = NULL`; assert that shape, not an empty table.)
- [ ] AC-3 The static/DCR path from spec 02 still works unchanged after CIMD is enabled.

Adversarial / security (a build can pass AC-1..3 and still fail these):

- [ ] AC-4 **Non-HTTPS `client_id` rejected:** a `client_id` whose URL is not HTTPS is refused before any document is fetched.
- [ ] AC-5 **Malformed identifier rejected:** a `client_id` URL with a fragment or userinfo component is refused (the draft's URL rules), not normalized-and-accepted.
- [ ] AC-6 **Document must match the request:** a metadata document whose `redirect_uris` (or self-declared `client_id`) disagree with the request is rejected; a forged document cannot authorize a redirect it does not list.
- [ ] AC-7 **Fails closed:** an unreachable or non-JSON metadata document yields no resolved client and no token, rather than falling through to an open default.

## Notes for the builder

- **This is genuinely edge.** CIMD is an IETF **draft** (`draft-ietf-oauth-client-id-metadata-document`, WG-adopted, **not yet an RFC**). The MCP `2026-07-28` spec recommends CIMD and **deprecates DCR**, which is why it is worth learning now even though it is pre-release.
- **Version reality:** the plugin is `@better-auth/cimd`, on the **v1.7.0 pre-release** line. The proven, pinned set is `better-auth@1.7.0-rc.0`, `@better-auth/oauth-provider@1.7.0-rc.0`, `@better-auth/cimd@1.7.0-rc.0`, with the peer `better-call@1.3.7`. This is pinned and proven, not unknown — but it is pre-release, so re-check versions at ship time.
- **Wiring:** `cimd({ allowLoopback: true })` listed **after** `oauthProvider()` (it extends the provider in `init()`). `allowLoopback` lets a loopback `http://localhost/...client.json` `client_id` work locally; off-loopback HTTPS is strictly enforced. Useful options: `refreshRate`, `originBoundFields`, `allowLoopback`, `allowFetch`. Discovery advertises `client_id_metadata_document_supported: true`. Alt path: `oauthProvider({ extensions: [{ clientDiscovery: cimdClientDiscovery() }] })` — `extensions`, not a top-level `clientDiscovery`.
- **Two 1.7 migration gotchas** (the base already handles both): (1) pin `kysely` to `0.28.17` via a pnpm override — kysely `0.29` dropped the `DEFAULT_MIGRATION_TABLE` runtime export the migrator needs, else every `/api/auth/*` route 500s; (2) OIDC discovery moved to the **issuer root** (the internal endpoints are `SERVER_ONLY`), so add Next route handlers at `src/app/.well-known/openid-configuration/route.ts` and `.well-known/oauth-authorization-server/route.ts` that forward to `auth.handler`. JWKS stays at `/api/auth/jwks`. (Minor: `/oauth2/userinfo` returns 401 even with a valid token on `rc.0` — flag, don't chase.)
- **Verify the live surface at ship time.** It is pre-release, so import paths and call shape can still move. Query the **live Better Auth docs MCP** (`https://mcp.better-auth.com/mcp`) for the current `@better-auth/cimd` API and re-confirm the wiring above before relying on it.
- Read `.agents/skills/agent-identity-issuer/` section 2 (it has the manual → DCR → CIMD progression and the verified CIMD facts) and section 1 (the issuer config you are extending).
- Keep the issuer invariants from spec 02: hashed client secrets where they still apply, public-only JWKS, finite `exp`. CIMD changes how a client is _identified_, not how tokens are _signed or verified_.

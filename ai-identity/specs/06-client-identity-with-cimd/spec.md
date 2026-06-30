# spec.md — Client identity with CIMD

> **Core, but edge.** This is the last spec on the core spine, and it is the one that steps off stable ground. It runs on Better Auth's **v1.7.0 pre-release** line and an IETF **draft** standard. Stable `better-auth` (1.6.23) is DCR-only, so this spec deliberately moves you to the 1.7 rc/beta channel. The surface is moving — confirm the exact current API against the live Better Auth docs MCP before you build, and pin whatever versions you land on.

## Goal

Stop pre-registering clients. So far a client proved who it was with a fixed `client_id` you minted ahead of time (a DB row, spec 02). Here a client identifies itself **by URL**: its `client_id` is an `https` address that hosts a JSON metadata document, and your issuer fetches that document on demand instead of keeping a record. No pre-registration, no DB row, no shared setup step. This is the durable answer to "how does a client prove who it is" that the MCP world is moving toward (CIMD), and it is one spec past the manual/DCR mechanisms you already have.

## User Scenarios

- A client whose `client_id` is an HTTPS URL (e.g. `https://app.example.com/oauth-client.json`) starts an authorization-code flow; AuthCo fetches that URL, reads the metadata document, and proceeds with no prior registration.
- A developer inspects AuthCo's discovery document and sees `client_id_metadata_document_supported: true` advertised next to the existing capabilities.
- A client presents a `client_id` URL that is not HTTPS, or carries a fragment, or embeds userinfo — AuthCo refuses it before fetching anything.

## Functional Requirements

- FR-1 Move AuthCo to the Better Auth **v1.7.0 pre-release** channel and add CIMD support. In the pre-release surface this is either the `cimd()` plugin **or** passing `cimdClientDiscovery()` to `oauthProvider({ clientDiscovery })`. Confirm the exact import paths and call shape against the live Better Auth docs MCP (`https://mcp.better-auth.com/mcp`) before wiring — this is pre-release and the surface moves.
- FR-2 Discovery advertises the capability: AuthCo's `/.well-known/openid-configuration` (and/or the OAuth authorization-server metadata) now includes `client_id_metadata_document_supported: true`.
- FR-3 A URL-shaped `client_id` is resolved by **fetching its metadata document**, not by a DB lookup. An HTTPS-URL `client_id` whose JSON metadata document is reachable lets the flow proceed with no pre-registered `oauthClient` row.
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
- [ ] AC-2 A URL `client_id` is **resolved by fetch, not by DB**: an authorization-code flow with an HTTPS-URL `client_id` completes after AuthCo fetches the metadata document, with **no** `oauthClient` row for that client.
- [ ] AC-3 The static/DCR path from spec 02 still works unchanged after CIMD is enabled.

Adversarial / security (a build can pass AC-1..3 and still fail these):

- [ ] AC-4 **Non-HTTPS `client_id` rejected:** a `client_id` whose URL is not HTTPS is refused before any document is fetched.
- [ ] AC-5 **Malformed identifier rejected:** a `client_id` URL with a fragment or userinfo component is refused (the draft's URL rules), not normalized-and-accepted.
- [ ] AC-6 **Document must match the request:** a metadata document whose `redirect_uris` (or self-declared `client_id`) disagree with the request is rejected; a forged document cannot authorize a redirect it does not list.
- [ ] AC-7 **Fails closed:** an unreachable or non-JSON metadata document yields no resolved client and no token, rather than falling through to an open default.

## Notes for the builder

- **This is genuinely edge.** CIMD is an IETF **draft** (`draft-ietf-oauth-client-id-metadata-document`, WG-adopted, **not yet an RFC**). The MCP `2026-07-28` spec recommends CIMD and **deprecates DCR**, which is why it is worth learning now even though it is pre-release.
- **Version reality:** the plugin is `@better-auth/cimd`, shipping only in the **v1.7.0 pre-release** line (`@better-auth/cimd@1.7.0-rc.0`, latest beta `1.7.0-beta.10`). Stable `better-auth` is `1.6.23` and is **DCR-only** — so this spec requires moving to the 1.7 rc/beta channel. Pin the exact versions you build against.
- **Verify the live surface first.** Because this is pre-release, the import paths and call shape can move between betas. Before building, query the **live Better Auth docs MCP** (`https://mcp.better-auth.com/mcp`) for the current `@better-auth/cimd` API — `cimd()` vs `cimdClientDiscovery()` / `oauthProvider({ clientDiscovery })`, and the exact discovery key. Build from what the MCP returns, not from memory.
- Read `.agents/skills/agent-identity-issuer/` section 2 (it has the manual → DCR → CIMD progression and the verified CIMD facts) and section 1 (the issuer config you are extending).
- Keep the issuer invariants from spec 02: hashed client secrets where they still apply, public-only JWKS, finite `exp`. CIMD changes how a client is _identified_, not how tokens are _signed or verified_.

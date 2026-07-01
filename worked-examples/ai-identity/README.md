# AI Identity — reference solution

The finished build for the **AI Identity** course, for after you have done it yourself. This is the answer key: read it when you are stuck or want to compare, not as your starting point. The base you build from is [`../../ai-identity/`](../../ai-identity).

This solution runs on **Better Auth `1.7.0-rc.0`** (the pre-release line, because that is where CIMD lives) with **`@better-auth/agent-auth` `0.6.2`** for the agent frontier. It implements the whole course as separate, runnable apps — the issuer plus a real OAuth client, a real resource server, a CIMD metadata host, and an external agent runtime — driven end to end by the acceptance scripts in `scripts/`.

## What it demonstrates

An **AuthCo** identity service on Better Auth (Next.js + shadcn), covering the full spine of the course plus the agent frontier:

- **Own your sign-in** — email/password (12-char minimum), sessions, and the sign-in / sign-up / dashboard UI (`src/app/`, `src/lib/auth.ts`).
- **Become the issuer** — the `jwt` + `@better-auth/oauth-provider` plugins: OIDC discovery, public JWKS, the authorization-code + PKCE flow, consent, and hashed client secrets at rest.
- **Scopes & consent** — first-class `notes.read` / `notes.write` scopes, a `/consent` screen that renders exactly the signed request, and per-client scope restriction.
- **Connect a real app** — a genuinely separate `notes/` app (its own process, `jose` only, no AuthCo import) runs the full code flow and verifies the ID token offline via JWKS.
- **Connect a resource server** — a standalone `resource-server/` (`notes-api-resource-server`) verifies **RS256**, audience-bound (RFC 8707) access tokens offline via JWKS, rejecting tampered / expired / wrong-algorithm tokens.
- **Client identity with CIMD** — `@better-auth/cimd` resolves a URL-shaped `client_id` by fetching a hosted metadata document (`cimd-client/`), with the adversarial URL-rule / fail-closed checks.
- **The frontier: agent identity** — `@better-auth/agent-auth` gives an agent its **own** short-lived, self-signed Ed25519 credential (`agent-consumer/`), on-behalf-of delegation with human device-code approval, value-level constraints, single-use grants, and a step-up ladder (`none` → `session` → `webauthn`).

## Verification status

Verified live against Neon on Better Auth `1.7.0-rc.0`. Each `scripts/accept-*.mjs` boots against the running issuer and prints per-criterion PASS/FAIL:

| Script              | Covers                                                                            | Live result                                             |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `accept-agent.mjs`  | agent gets its own credential; replay / forgery / expiry / revocation             | **4/4**                                                 |
| `accept-obo.mjs`    | on-behalf-of: device-code approval, value constraint, single-use, granular revoke | **6/6**                                                 |
| `accept-stepup.mjs` | approval ladder `none`/`session`/`webauthn`, constraint enforcement, single-use   | **5/5**                                                 |
| `accept-02.mjs`     | issuer: PKCE, RS256 id_token, hashed secret, code replay, aud/iss/exp             | **9/9**                                                 |
| `accept-06.mjs`     | CIMD: URL `client_id`, adversarial URL rules, fail-closed                         | **7/7**                                                 |
| `accept-03.mjs`     | scopes & consent, resource-target restriction                                     | run after seeding the read/write clients per `specs/03` |
| `accept-04.mjs`     | Notes client, offline JWKS verify, revocation                                     | run with the `notes/` app on `:4000`                    |
| `accept-05.mjs`     | resource server, offline RS256 verify, wrong-aud / wrong-alg / expiry             | run with the `resource-server/` on `:8000`              |

The frontier plane (the beta `@better-auth/agent-auth` half) and the issuer + CIMD are the load-bearing, novel parts, and are green live. The remaining spine scripts drive the standard OAuth-client / resource-server flows and need their aux servers plus DB-row clients seeded per each spec (`createOAuthClient` is session-gated; the specs seed a fixed-id client as a DB row whose `clientSecret` is `base64url(SHA-256(secret))`).

## Notes on config choices

- **Database:** this reference uses **Neon Postgres** (`@neondatabase/serverless`) — the base's real target. It is **not keyless**: set a `DATABASE_URL` in `.env` (copy `.env.example`) before running. Swapping to a local SQLite file for a zero-account run is a one-line adapter change in `src/lib/auth.ts`.
- **Two token planes, two algorithms:** human tokens are **RS256** (typical resource-server verifiers — FastMCP's `JWTVerifier`, python-jose, gateways — expect RS256, not the EdDSA default). Agent credentials are **EdDSA / Ed25519** (short-lived, self-signed proof-of-possession). The two planes share one server but never share a credential.
- **OIDC discovery lives at the issuer path, not the root.** This build's OAuth issuer is `http://localhost:3000/api/auth`, so discovery is served at `/api/auth/.well-known/openid-configuration`. Forcing the issuer to the root by setting a `jwt` issuer collides with the oauth-provider on `1.7.0-rc.0` and 404s the discovery doc — see the note in `src/lib/auth.ts`. (`AGENTS.md` / specs 02 and 06 describe the root-issuer variant; this build deliberately took the issuer-path route to keep discovery healthy on rc.0.)
- **The 1.7 kysely gotcha (handled):** pin `kysely` to `0.28.17` via a pnpm override in `package.json` — kysely `0.29` dropped a runtime export Better Auth's migrator imports, else every `/api/auth/*` route 500s.
- **Projects:** the frontier projects (`specs/projects/agent-credential`, `on-behalf-of`, `step-up-approval`) are fully built here. The stable-tier projects (`specs/projects/2fa`, `social-login`) ship as **specs only** — they are the reader's ~50% milestone to build, and are not implemented in this reference.

## Verify the current surface

This is a pre-release. Pin the versions you land on, and re-confirm the API at ship time against the live Better Auth docs MCP (`https://mcp.better-auth.com/mcp`) before relying on it.

## Run it

```bash
cp .env.example .env      # set DATABASE_URL (Neon) and BETTER_AUTH_SECRET
pnpm install
pnpm dev                  # AuthCo issuer on http://localhost:3000

# then, against the running issuer:
node scripts/accept-agent.mjs
node --env-file=.env scripts/accept-obo.mjs
node --env-file=.env scripts/accept-stepup.mjs
```

See `AGENTS.md` for the full toolchain recipe and `specs/` for the per-capability acceptance criteria.

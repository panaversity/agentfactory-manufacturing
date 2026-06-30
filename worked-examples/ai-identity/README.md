# AI Identity — reference solution

The finished build for the **AI Identity** course, for after you have done it yourself. This is the answer key: read it when you are stuck or want to compare, not as your starting point. The base you build from is [`../../ai-identity/`](../../ai-identity).

This solution runs on **Better Auth `1.7.0-rc.0`** (the pre-release line), because that is where CIMD lives. The whole core spine is proven on it: the issuer passes `verify.sh` 10/10, and CIMD passes `cimd-verify.sh` 10/10.

## What it demonstrates

A working AuthCo identity service on Better Auth (Next.js + shadcn), covering the full core spine of the course:

- **Own your sign-in** — email/password, sessions, and the sign-in / sign-up / dashboard UI (`src/app/`, `src/lib/auth.ts`, `src/lib/auth-client.ts`).
- **Become the issuer** — the `jwt` + `@better-auth/oauth-provider` plugins: OIDC discovery, public JWKS, the authorization-code + PKCE flow, consent, and userinfo.
- **Connect a real app** — an independent `notes-consumer/` runs the full code flow and verifies the ID token offline using only the JWKS.
- **Connect a resource server** — the `jwt` plugin signs **RS256** tokens audience-bound to a resource URL (the path proven live against the Connector-Native Apps gateway: `begin_session` accepted a 1.7 RS256 token and rejected a tampered one with 401).
- **Client identity with CIMD** — the `@better-auth/cimd` plugin is wired and **proven**. An independent `cimd-consumer/` identifies itself by a URL `client_id` (a hosted metadata document), runs the public-client code flow, and the issuer resolves it by fetch. See [`CIMD.md`](./CIMD.md).

`verify.sh` checks the issuer acceptance criteria end to end (issuer + offline JWKS verification + the adversarial security gates). `cimd-verify.sh` does the same for CIMD (happy path + six adversarial URL-rule / fail-closed checks).

## Notes on config choices

- **Database:** this reference uses a local **SQLite** file for a keyless, zero-account run. The base targets **Neon Postgres** (`@neondatabase/serverless`); swapping the adapter is a one-line change in `src/lib/auth.ts`.
- **Signing algorithm:** `jwt({ jwks: { keyPairConfig: { alg: "RS256" } } })`. Better Auth's docs label this `"RSA256"`, but `jose` only accepts `"RS256"` — using the doc value throws `JOSENotSupported` at `/api/auth/token`.
- **Client registration:** a fixed-id client is seeded as a DB row (`scripts/seed-client.mjs`), because `createOAuthClient` is session-gated and mints a random id. The course teaches this as one point on the manual → DCR → CIMD spectrum; CIMD (below) is the next point along.

## The two 1.7 migration gotchas (already handled here)

Moving onto the 1.7 pre-release surfaces two traps that this build already fixes. If you rebuild from the base, expect them:

1. **Pin `kysely` to `0.28.17`.** kysely `0.29` removed the `DEFAULT_MIGRATION_TABLE` runtime barrel export that Better Auth's migrator imports. Without the pin, every `/api/auth/*` route 500s. The fix is a pnpm override in `package.json`:

   ```json
   "pnpm": { "overrides": { "kysely": "0.28.17" } }
   ```

2. **Serve OIDC discovery from the issuer root.** In 1.7 the discovery endpoints became `SERVER_ONLY`, so they are no longer exposed under `/api/auth`. The plugin answers them through an `onRequest` hook at the issuer-root path (`/.well-known/openid-configuration`), which Next does not route to the Better Auth handler on its own. Two thin route handlers forward those paths to `auth.handler`:

   - `src/app/.well-known/openid-configuration/route.ts`
   - `src/app/.well-known/oauth-authorization-server/route.ts`

   JWKS stays at `/api/auth/jwks`. (Minor flag, not chased here: `/oauth2/userinfo` returns 401 even with a valid token on `rc.0`.)

## Verify the current surface

This is a pre-release. Pin the versions you land on, and re-confirm the API at ship time against the live Better Auth docs MCP (`https://mcp.better-auth.com/mcp`) before relying on it.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
./verify.sh         # issuer acceptance checks (10/10)
./cimd-verify.sh    # CIMD acceptance checks (10/10)
```

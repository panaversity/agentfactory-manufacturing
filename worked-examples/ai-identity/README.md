# AI Identity — reference solution

The finished build for the **AI Identity** course, for after you have done it yourself. This is the answer key: read it when you are stuck or want to compare, not as your starting point. The base you build from is [`../../ai-identity/`](../../ai-identity).

## What it demonstrates

A working AuthCo identity service on **Better Auth** (Next.js + shadcn), covering the stable half of the course:

- **Own your sign-in** — email/password, sessions, and the sign-in / sign-up / dashboard UI (`src/app/`, `src/lib/auth.ts`, `src/lib/auth-client.ts`).
- **Become the issuer** — the `jwt` + `@better-auth/oauth-provider` plugins: OIDC discovery, public JWKS, the authorization-code + PKCE flow, consent, and userinfo.
- **Connect a real app** — an independent `notes-consumer/` runs the full code flow and verifies the ID token offline using only the JWKS.
- **Connect a resource server** — the `jwt` plugin signs **RS256** tokens audience-bound to a resource URL (the path proven live against the Connector-Native Apps gateway).

`verify.sh` checks the acceptance criteria end to end (issuer + offline JWKS verification + the adversarial security gates).

## Notes on config choices

- **Database:** this reference uses a local **SQLite** file for a keyless, zero-account run. The base targets **Neon Postgres** (`@neondatabase/serverless`); swapping the adapter is a one-line change in `src/lib/auth.ts`.
- **Signing algorithm:** `jwt({ jwks: { keyPairConfig: { alg: "RS256" } } })`. Better Auth's docs label this `"RSA256"`, but `jose` only accepts `"RS256"` — using the doc value throws `JOSENotSupported` at `/api/auth/token`.
- **Client registration:** a fixed-id client is seeded as a DB row (`scripts/seed-client.mjs`), because `createOAuthClient` is session-gated and mints a random id. The course teaches this as one point on the manual → DCR → CIMD spectrum.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
./verify.sh         # runs the acceptance checks
```

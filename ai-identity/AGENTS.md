<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Constitution — AuthCo (your own identity service)

You are building a production-grade identity service on **Better Auth** in this Next.js app, one spec at a time. You do not work from memory: the knowledge you need is already here.

## How this project is built

- The files in `specs/` are the **source of truth**. Each describes one capability (sign-in, the issuer, scopes, …) with acceptance criteria. You build the behaviour the spec describes; if you find a gap, fix the spec first, then the code.
- Before writing any auth code, read the matching skill in `.agents/skills/`:
  - Email/password, sessions, security → the official `better-auth-*` skills.
  - **Making this app an OIDC/OAuth _issuer_, and giving an agent its own identity → `.agents/skills/agent-identity-issuer/`.** The official skills do NOT cover issuance; this one does, with verified config.
- One spec at a time. Plan the change, build it in small steps, and run that spec's acceptance checks before moving on.

## The stack (already installed — do not swap)

- Next.js (App Router) + React + Tailwind + shadcn/ui components in `src/components/ui/`.
- **Better Auth 1.7+** (currently the `1.7.0-rc` pre-release, pinned) + `@better-auth/oauth-provider` + `@better-auth/cimd` for the issuer and client identity. The pre-release line is deliberate: CIMD (spec 06) lives there. Pin the versions you build against and re-check at ship time.
- **Database: Neon Postgres via `@neondatabase/serverless`** (pure JS, no native build). The connection string is `DATABASE_URL` in `.env`. Never hard-code it.

### Two 1.7 gotchas to expect (don't fight them)

- **Pin `kysely` to `0.28.17`** — already set as a pnpm override in `package.json`. kysely `0.29` dropped the `DEFAULT_MIGRATION_TABLE` runtime export Better Auth's migrator imports; without the pin, every `/api/auth/*` route 500s. Don't remove it.
- **OIDC discovery is served from the issuer root** in 1.7 (the internal discovery endpoints are `SERVER_ONLY`). When you build the issuer, add Next route handlers at `src/app/.well-known/openid-configuration/route.ts` and `src/app/.well-known/oauth-authorization-server/route.ts` that forward to `auth.handler`. JWKS stays at `/api/auth/jwks`.

## Identity invariants (never violate)

- Every token and session has an explicit, finite expiry. No non-expiring credential, ever.
- Secrets (`BETTER_AUTH_SECRET`, OAuth client secrets, signing keys, `DATABASE_URL`) live in `.env` only. Never hard-coded, never logged, never returned in a response.
- A password or password hash is never returned by any endpoint or logged.
- Authority is least-privilege: a credential gets the narrowest scope that does its job, and scope is enforced on every protected call, not just issued.
- Anything revocable must actually stop working after revocation — verify it, don't assume it.

## Definition of done (per spec)

- Behaviour matches the spec, including every acceptance criterion — the functional ones AND the adversarial/security ones.
- The app boots clean; the spec's acceptance checks pass.
- A human has reviewed the diff against the spec before it ships.

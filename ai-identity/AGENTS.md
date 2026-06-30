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
- Better Auth + `@better-auth/oauth-provider` for the issuer.
- **Database: Neon Postgres via `@neondatabase/serverless`** (pure JS, no native build). The connection string is `DATABASE_URL` in `.env`. Never hard-code it.

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

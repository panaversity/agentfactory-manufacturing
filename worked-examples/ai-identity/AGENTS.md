<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Constitution — AuthCo SSO Server

You are building a production-grade identity service on **Better Auth 1.7.0-rc.0** (the pre-release line, pinned — CIMD lives there) in this Next.js app.
The expertise you need is in `.agents/skills/` — read the relevant skill before writing auth code; do not work from memory.

Two 1.7 gotchas this build already handles, so don't undo them: the `kysely` pnpm override (`0.28.17`) in `package.json` (1.7's kysely dep dropped a runtime export the migrator needs, else every `/api/auth/*` route 500s), and the issuer-root `.well-known` route handlers in `src/app/.well-known/` (1.7 made OIDC discovery server-only, so Next forwards those paths to `auth.handler`).

## Principles

- The spec in `specs/` is the source of truth. Build behaviour to match it; if you find a gap, fix the spec first, then the code.
- Prefer Better Auth's own plugins over hand-rolled crypto, routes, or token logic. Research the skill, then configure.
- Plain, reviewable code. A new contributor should understand any file in five minutes.

## Identity invariants (these must never be violated)

- Every token and session has an explicit, finite expiry. No non-expiring credential, ever.
- Secrets (BETTER_AUTH_SECRET, OAuth client secrets, signing keys) live in env only. Never hard-coded, never logged, never returned in a response.
- A password or password hash is never returned by any endpoint or logged.
- Authority is least-privilege: a credential gets the narrowest scope that does its job, and scope is enforced on every protected call (not just issued).
- Anything that can be revoked must actually stop working after revocation — verify it, don't assume it.

## Definition of done

- Behaviour matches the spec, including every acceptance criterion (functional AND the adversarial/security ones).
- The app boots clean and `./verify.sh` (issuer, 10/10) passes from a fresh clone; `./cimd-verify.sh` (CIMD, 10/10) passes once the `cimd()` plugin is wired.
- A human has reviewed the diff against the spec before it ships.

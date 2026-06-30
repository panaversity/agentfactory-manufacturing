# Constitution — AuthCo (your own identity service)

You build a production-grade identity service on **Better Auth**, one spec at a time, by directing your coding agent. This base is intentionally minimal: rules (this file), a library of `specs/`, the reader prompts, and the one skill that can't be installed off the shelf. There is no app here yet — **you set the toolchain up first** (below), then manufacture each capability from its spec.

## Set up the base (do this first, when the reader asks)

Follow `specs/00-set-up-the-base/spec.md`. In short, the agent:

1. **Scaffolds the app** in this folder: Next.js (App Router) + TypeScript + Tailwind + **shadcn/ui** (`npx create-next-app@latest . --ts --app --tailwind --src-dir --eslint`, then `npx shadcn@latest init -d`).
2. **Installs the skills** it needs (this base ships only the one below; install the rest):
   - `npx skills add better-auth/skills` — the official Better Auth skills (core, email/password, 2FA, security).
   - `npx skills add https://github.com/shadcn/ui --skill shadcn`.
   - Already here, shipped (not installable): `.agents/skills/agent-identity-issuer/` — OIDC/OAuth **issuance** and **agent identity**, the gap the official skills don't cover.
3. **Pins Better Auth 1.7+** (the issuer + CIMD live on the pre-release line):
   `pnpm add better-auth@1.7.0-rc.0 @better-auth/oauth-provider@1.7.0-rc.0 @better-auth/cimd@1.7.0-rc.0` and add the pnpm override `{ "kysely": "0.28.17" }`. Pin what you land on; re-check at ship time.
4. **Wires the database**: Neon Postgres via `@neondatabase/serverless` (pure JS, no native build). Put the connection string in `.env` as `DATABASE_URL` (copy `.env.example`). Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
5. **(Optional) Connects the Better Auth docs MCP** so you can confirm the live API on the moving 1.7 surface: `npx auth@latest mcp` (or the endpoint `https://mcp.better-auth.com/mcp`).

**Done when** the app boots to a landing page at `http://localhost:3000` and `pnpm build` is clean. After `create-next-app`, Next ships its own agent rules + docs in `node_modules/next/dist/docs/` — read them before writing Next 16 code.

### Two 1.7 gotchas to expect (don't fight them)

- **Pin `kysely` to `0.28.17`** (the pnpm override above). kysely `0.29` dropped the `DEFAULT_MIGRATION_TABLE` runtime export Better Auth's migrator imports; without the pin, every `/api/auth/*` route 500s.
- **OIDC discovery is served from the issuer root** in 1.7 (the internal discovery endpoints are `SERVER_ONLY`). When you build the issuer (spec 02), add Next route handlers at `src/app/.well-known/openid-configuration/route.ts` and `src/app/.well-known/oauth-authorization-server/route.ts` that forward to `auth.handler`. JWKS stays at `/api/auth/jwks`.

## How this project is built

- The files in `specs/` are the **source of truth**. Each describes one capability with acceptance criteria. Build the behaviour the spec describes; if you find a gap, fix the spec first, then the code.
- Before writing any auth code, read the matching skill: core sign-in/sessions/2FA/security → the installed `better-auth-*` skills; **making this app an OIDC/OAuth _issuer_ or giving an agent its own identity → `.agents/skills/agent-identity-issuer/`** (shipped, with verified config).
- One spec at a time. Plan the change, build it in small steps, and run that spec's acceptance checks before moving on.

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

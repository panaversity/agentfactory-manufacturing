# spec.md — Set up the base

## Goal

Stand up the empty toolchain you will build the identity service on. This base ships rules, specs, and prompts but no app — your first move is to direct the agent to scaffold it. That is the point: setup is your first rep of the loop you will use for every capability after this. You do it in **two phases**: first prove the environment (prerequisites, skills, MCP servers), then scaffold the app and get it serving. When this is done you have a booting Next.js app with the right skills, the Better Auth 1.7 stack pinned, and a database wired, and nothing about identity built yet.

---

## Phase 1 — Environment (prove the ground before you build on it)

### Functional Requirements

- FR-1 **Prerequisites verified.** Node.js (20+) and a package manager are present. Prefer `pnpm` (enable via `corepack enable pnpm` if missing); `npm` is an acceptable fallback. Print the versions so they're on the record.
- FR-2 **Skills installed** (universal — no `--agent` flag, so they serve Claude Code and OpenCode): `npx skills add better-auth/skills` (official core / email-password / 2FA / security), `npx skills add https://github.com/shadcn/ui --skill shadcn`, and `npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres -y` (Neon Postgres expertise, pairs with the Neon MCP). The `agent-identity-issuer` skill is already shipped here. (`npx skills add` can silently drop an unknown name — confirm by listing the skills dir after.)
- FR-3 **MCP servers wired.** `.mcp.json` (Claude Code) and `opencode.json` (OpenCode) ship the `better-auth`, `Neon`, and `context7` servers. Confirm they're present and the endpoints are reachable. (Neon prompts for auth on first connect — that's expected.)

### Acceptance Criteria — Phase 1

- [ ] AC-1 Node 20+ and `pnpm` (or `npm`) report a version.
- [ ] AC-2 The skills are present: the official `better-auth-*`, `shadcn`, and `neon-postgres` skills installed, plus the shipped `agent-identity-issuer`.
- [ ] AC-3 `.mcp.json` and `opencode.json` exist and name `better-auth`, `Neon`, `context7`; each endpoint is reachable (an HTTP response, even 401/405/406, not a DNS/connection failure).

---

## Phase 2 — Scaffold and boot (the app comes alive)

### Functional Requirements

- FR-4 **Scaffold** a Next.js (App Router) + TypeScript + Tailwind + **shadcn/ui** app in this folder. The folder is **not empty**, so `create-next-app .` refuses and would clobber this base's `AGENTS.md`/`CLAUDE.md`. Use the in-place recipe in `AGENTS.md` step 1: scaffold into a temp dir with `create-next-app@latest .scaffold --ts --app --tailwind --src-dir --eslint --turbopack --import-alias "@/*" --use-pnpm --yes`, then `rsync -a --ignore-existing .scaffold/ ./ && rm -rf .scaffold` (base files win), then `npx shadcn@latest init -d`.
- FR-5 **Pin the Better Auth 1.7 stack:** `better-auth@1.7.0-rc.0`, `@better-auth/oauth-provider@1.7.0-rc.0`, `@better-auth/cimd@1.7.0-rc.0`, plus the pnpm override `{ "kysely": "0.28.17" }`. Add `@neondatabase/serverless`.
- FR-6 **Env from template.** Create `.env` from `.env.example` with `DATABASE_URL` (a Neon connection string — a placeholder is fine until spec 01 needs the DB), a generated `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`, and `RESOURCE_URL`.
- FR-7 **A neutral landing page** at `/` that links to nothing that does not exist yet. No auth code.

### Acceptance Criteria — Phase 2

- [ ] AC-4 `pnpm dev` serves a landing page at `http://localhost:3000` (HTTP 200), with no auth routes.
- [ ] AC-5 `pnpm build` and `npx tsc --noEmit` both pass.
- [ ] AC-6 The pinned versions are exactly `better-auth@1.7.0-rc.0`, `@better-auth/oauth-provider@1.7.0-rc.0`, `@better-auth/cimd@1.7.0-rc.0`.
- [ ] AC-7 The `kysely` pnpm override (`0.28.17`) is present in `package.json` — without it the issuer routes will 500 later.
- [ ] AC-8 `.env` exists, created from `.env.example`, with `DATABASE_URL` set. The shipped `.gitignore` already ignores `.env*` and re-includes `.env.example`, so once this folder is a git repo the secret stays out of it (no real secret is ever committed).

---

## Edge Cases & Rules

- Build nothing identity-related. No auth, issuer, or UI beyond a plain landing page — that is what specs 01+ are for.
- If `create-next-app` or `shadcn init` prompts interactively, use the non-interactive flags / defaults rather than stalling.
- The booting landing page does not need a real database; `DATABASE_URL` can be a placeholder until spec 01.

## Out of Scope (this spec)

- Sign-in, sessions, the issuer, scopes, CIMD, agents. Everything identity-related is a later spec.

## Notes for the builder

- This is the reader's first manufacture. Keep it boring and verifiable: prove the environment (Phase 1), then scaffold and boot (Phase 2). Resist building anything identity-related.
- The two 1.7 gotchas (kysely override, issuer-root discovery) are in `AGENTS.md`. The kysely override belongs here at setup; the `.well-known` route handlers come when you build the issuer (spec 02), not now.
- After scaffolding, read `node_modules/next/dist/docs/` for Next 16 conventions before writing any Next code in later specs.

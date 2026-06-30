# spec.md — Set up the base

## Goal

Stand up the empty toolchain you will build the identity service on. This base ships rules, specs, and prompts but no app — your first move is to direct the agent to scaffold it. That is the point: setup is your first rep of the loop you will use for every capability after this. When this is done you have a booting Next.js app with the right skills, the Better Auth 1.7 stack pinned, and a database wired, and nothing about identity built yet.

## User Scenarios

- A reader clones this base, opens it in their coding agent, and says "set up the base." The agent scaffolds the app, installs the skills, pins the dependencies, and confirms the app boots, without the reader hand-running each command.
- The reader visits `http://localhost:3000` and sees a plain landing page (no auth yet), proving the toolchain is live.

## Functional Requirements

- FR-1 Scaffold a Next.js (App Router) + TypeScript + Tailwind + **shadcn/ui** app in this folder. (`create-next-app` with `--ts --app --tailwind --src-dir --eslint`, then `shadcn init` non-interactively.)
- FR-2 Install the skills: `npx skills add better-auth/skills` and `npx skills add https://github.com/shadcn/ui --skill shadcn`. The `agent-identity-issuer` skill is already present.
- FR-3 Pin the Better Auth 1.7 stack: `better-auth@1.7.0-rc.0`, `@better-auth/oauth-provider@1.7.0-rc.0`, `@better-auth/cimd@1.7.0-rc.0`, plus the pnpm override `{ "kysely": "0.28.17" }`. Add `@neondatabase/serverless`.
- FR-4 Create `.env` from `.env.example` with `DATABASE_URL` (a Neon connection string), a generated `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`, and `RESOURCE_URL` (used later by the resource-server spec).
- FR-5 A neutral landing page at `/` that links to nothing that does not exist yet. No auth code.

## Edge Cases & Rules

- Do not build any auth, issuer, or UI beyond a plain landing page. That is what specs 01+ are for.
- If `create-next-app` or `shadcn init` prompts interactively, use the non-interactive flags / defaults rather than stalling.

## Out of Scope (this spec)

- Sign-in, sessions, the issuer, scopes, CIMD, agents. Everything identity-related is a later spec.

## Acceptance Criteria

Functional:

- [ ] AC-1 `pnpm dev` serves a landing page at `http://localhost:3000` (HTTP 200), with no auth routes.
- [ ] AC-2 `pnpm build` and `npx tsc --noEmit` both pass.
- [ ] AC-3 The skills are present: the official `better-auth-*` and `shadcn` skills installed, plus the shipped `agent-identity-issuer`.

Setup-correctness (these prevent the 1.7 traps from biting later):

- [ ] AC-4 The pinned versions are exactly `better-auth@1.7.0-rc.0`, `@better-auth/oauth-provider@1.7.0-rc.0`, `@better-auth/cimd@1.7.0-rc.0`.
- [ ] AC-5 The `kysely` pnpm override (`0.28.17`) is present in `package.json` — without it the issuer routes will 500 later.
- [ ] AC-6 `.env` exists with `DATABASE_URL` set; no secret is committed (`.env` is gitignored, only `.env.example` is tracked).

## Notes for the builder

- This is the reader's first manufacture. Keep it boring and verifiable: scaffold, install, pin, boot. Resist building anything identity-related.
- The two 1.7 gotchas (kysely override, issuer-root discovery) are in `AGENTS.md`. The override belongs here at setup; the `.well-known` route handlers come when you build the issuer (spec 02), not now.
- After scaffolding, read `node_modules/next/dist/docs/` for Next 16 conventions before writing any Next code in later specs.

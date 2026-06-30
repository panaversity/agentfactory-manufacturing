# Lesson 0 — Set up the base · uses `specs/00-set-up-the-base/spec.md`

This is your first rep: you don't scaffold by hand, you direct the agent to. Do it in two phases so you can see each half work before the next.

**Phase 1 — prove the environment:**

> Read `specs/00-set-up-the-base/spec.md` (Phase 1) and the "Set up the base" section of `AGENTS.md`. Check my prerequisites (Node, pnpm), install the Better Auth and shadcn skills, and confirm the MCP servers in `.mcp.json` / `opencode.json` are present and reachable. Don't scaffold anything yet — just prove the ground, and run the Phase 1 acceptance checks.

**Phase 2 — scaffold and boot:**

> Now do Phase 2 of `specs/00-set-up-the-base/spec.md`: scaffold the Next.js + Tailwind + shadcn app here, pin the Better Auth 1.7 stack with the kysely override, add the Neon driver, and create `.env` from the template. Don't build any auth. Start the dev server and show me the landing page is up, then run the Phase 2 acceptance checks.

**Understand (no spec):**

> Walk me through what you just installed and why each piece is here: what does each skill give you, and why are we on the Better Auth 1.7 pre-release instead of stable?

> Show me the `kysely` override you added and explain, in plain English, what would break later if it weren't there.

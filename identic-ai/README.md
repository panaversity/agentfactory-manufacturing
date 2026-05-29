# Owner Delegation with Identic AI: base

This is the starting environment for the **Owner Delegation with Identic AI** crash course. You direct; your coding agent (Claude Code or OpenCode) builds the delegate on top of this base from the prompts you paste. The course's seven Decisions walk you through it.

You build an **Owner Identic AI**: a named OpenClaw delegate ("Claudia") that acts on the owner's behalf, reads the routine approval traffic of an AI-native company, resolves the slice inside an owner-set envelope, signs each decision, and surfaces the rest. The owner stays in control of consequential decisions; the routine flood stops reaching them.

## What is in this folder

- `AGENTS.md` (`CLAUDE.md` imports it): the standing brief your agent reads. It carries the delegate engine (native OpenClaw), the delegated-envelope schema, the two custom skills' recipes, the Paperclip MCP wiring, and the safety rules.
- `.mcp.json` / `opencode.json`: three MCP servers, all keyless against the local sandbox. Neon (the governance ledger), Context7 (verify the moving API surface), and the official Paperclip MCP (dormant until you start the local sandbox).
- `.env.example`: copy to `.env`, add a model key. The local Paperclip sandbox and Neon are keyless.
- `seed-company.json` + `course-seven-export/approvals.json`: Maya's four Workers and her prior decision history. Your agent loads these into a local Paperclip sandbox so you can do the whole lab with no upstream deployment.
- `docs/governance-ledger-schema.sql`: the one table the course adds, plus the real Paperclip tables it joins against.

## Pick how you run Paperclip

- **Local sandbox (default).** Your agent runs `npx paperclipai onboard --yes` (embedded Postgres, no key, local-trusted) and seeds Maya's company. This is the standalone path: no Course 5-7 stack required.
- **Bring your own.** If you have a deployed Paperclip from an earlier course, point the delegate at it by minting an agent key and setting `PAPERCLIP_API_KEY` in `.env`. Same architecture, one env var.

## How to start

Open this folder in your coding agent. `CLAUDE.md` loads `AGENTS.md`, which tells the agent how to install the skills, bring the MCP servers online, start the sandbox, and then have you restart it so the new tools load. Then work through the course, pasting one Decision's prompt at a time.

Reference solution: the finished delegate, the two custom skills, and a verified envelope live in `worked-examples/identic-ai/` at the repo root. Read it when you are stuck or want to compare, not as your starting point.

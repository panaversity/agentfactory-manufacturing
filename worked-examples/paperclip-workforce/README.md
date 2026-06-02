# Paperclip Workforce — worked solution (Manufacturing track)

This is the **finished end-state** of the Workforce with Paperclip crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org), not the empty starting point. It is what your folder looks like after you have run the course: a CEO proposed a strategy you approved, the board approved hiring a CMO, and the workforce delivered a real landing page, all under budgets, approvals, and a full audit trail.

Use it to check your own run against a reference, or to replay the whole company.

## What the workforce produced

- **`northwind-site/landing-page.html`**: the deliverable. The CMO wrote this standalone landing page for the "Northwind" weekly AI newsletter (NOR-8). Open it in a browser.
- **`northwind-company/`**: the company itself, as a portable, importable Paperclip package (`paperclipai company export`). It carries the org chart (CEO → CMO), all 8 tasks (`tasks/nor-1` … `nor-8`) with their full comment trail, the board approvals, and the agent definitions. No secrets; this is the readable end-state, exported on 2026-06-02.

Replay it into a fresh instance:

```bash
npx paperclipai company import ./northwind-company
```

(Importing creates fresh IDs, so they will not match `paperclip-instance.env`.)

## The operating context (same as the base)

- `AGENTS.md`: the standing operations brief (verified against a live install); `CLAUDE.md` loads it when your agent opens the folder.
- `.claude/skills/`: Paperclip's operator skills (`paperclip`, `paperclip-create-agent`, `diagnose-why-work-stopped`).
- `.env.example`: the one thing you supply, a model API key, exported in your shell, never stored here.
- `paperclip-instance.env`: the connection facts from the reference run (illustrative; yours will differ).

## What is deliberately NOT here

The live `paperclip-data/` directory (embedded Postgres, `secrets/master.key`, the JWT secret, and server logs) is git-ignored. It holds real local secrets, is an 85 MB version-locked binary, and would not start on your machine anyway. The readable, portable equivalent is `northwind-company/`.

## To run the course from scratch instead

Start from the **base** (empty starting point), not this folder. Open it in your coding agent (Claude Code or OpenCode) and follow the course. The agent onboards Paperclip (`npx paperclipai onboard --yes`, loopback: no account, no cloud), installs the operator skills, and drives the API and CLI from there.

Prerequisites: **Node.js 20+** and a **model API key** (Claude is Paperclip's default; OpenAI and others work). Budgets cap the spend; expect a few dollars.

How this differs from the SDK bases on this track: Paperclip ships its own embedded Postgres and is driven entirely through its CLI and REST API: no Neon, no Context7, no `.mcp.json`.

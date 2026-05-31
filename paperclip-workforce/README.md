# Paperclip base (Manufacturing track)

The starting point for the Workforce with Paperclip crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). You direct; your coding agent stands up Paperclip and runs an AI company (a CEO that proposes a strategy you approve, a board of tasks under budgets, approvals, and a full audit trail) from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the setup itself: it onboards Paperclip, installs Paperclip's operator skills, and drives the API and CLI from there.

What is here:

- `AGENTS.md` carries the standing operations brief (verified against a live install); `CLAUDE.md` loads it when your agent opens the folder.
- `.env.example` documents the one thing you supply: a model API key, exported in your shell, never stored here.

Prerequisites:

- **Node.js 20+** (`npx paperclipai onboard` is a Node CLI).
- **A model API key** from a provider you choose (Claude is Paperclip's default; OpenAI and others work). The CEO and its reports run on a real model, so you need one from Scenario 2 on. Budgets cap the spend; expect a few dollars to run the course.

How this base differs from the SDK bases on this track: Paperclip ships its own embedded Postgres and is driven entirely through its CLI and REST API, so there is no Neon, no Context7, and no `.mcp.json` MCP wiring here. The whole development plane is the local Paperclip install from `npx paperclipai onboard --yes` (loopback: no account, no cloud).

Your agent installs Paperclip's operator skills (`paperclip-create-agent`, `diagnose-why-work-stopped`) on the first prep prompt, so the hire flow and recovery stay current with Paperclip's own upstream MIT-licensed skills.

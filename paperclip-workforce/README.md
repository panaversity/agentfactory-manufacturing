# Paperclip base (Manufacturing track)

The starting point for the Workforce with Paperclip crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). You direct; your coding agent stands up Paperclip and runs a managed AI workforce (companies, Workers, issues, approvals, budgets, an audit trail) from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the setup itself: it onboards Paperclip, installs Paperclip's operator skills, and drives the API and CLI from there.

What is here:

- `AGENTS.md` carries the standing operations brief (verified against a live install); `CLAUDE.md` loads it when your agent opens the folder.
- `worker-stub.py` is the keyless local Worker you hire in the course: a standard-library HTTP server (~120 lines) that answers Paperclip's heartbeat and posts a disposition back. No LLM, no API key.
- `.env.example` documents the one optional key (Scenario 5's Gemini key), which you export in your shell, never store here.

Prerequisites:

- **Node.js 20+** (`npx paperclipai onboard` is a Node CLI).
- **Python 3** (to run `worker-stub.py`; standard library only, nothing to install).

How this base differs from the SDK bases on this track: Paperclip ships its own embedded Postgres and is driven entirely through its CLI and REST API, so there is no Neon, no Context7, and no `.mcp.json` MCP wiring here. The whole development plane is the local Paperclip install from `npx paperclipai onboard --yes` (keyless loopback: no account, no cloud). Only Scenario 5 (the budget lesson) needs an API key, a free Gemini key, exported in your shell.

Your agent installs Paperclip's operator skills (`paperclip-create-agent`, `diagnose-why-work-stopped`) on the first prep prompt, so the hire flow and recovery stay current with Paperclip's own upstream MIT-licensed skills.

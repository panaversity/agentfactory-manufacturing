# Production Worker base (Manufacturing track)

The starting point for the Production Worker crash course on the Manufacturing track of [The AI Agent Factory](https://learn.panaversity.org). You direct; your coding agent wraps your Course #4 Digital FTE in an Inngest operational envelope from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the setup itself: it installs the skills, confirms the MCP servers, sets up your `.env`, and builds from there.

This course **extends the customer-support Worker you built in the [Digital FTE course](https://learn.panaversity.org/docs/digital-fte-crash-course)**. Bring that Worker in when the course tells you to (the agent copies it here, or clones the reference solution as your floor if you did not build it). The Worker's internals do not change; you add Inngest around them.

What is here:

- `AGENTS.md` carries the standing rules; `CLAUDE.md` loads them when your agent opens the folder.
- `.mcp.json` (Claude Code) and `opencode.json` (OpenCode) wire three MCP servers: Neon (the system of record, over OAuth), Context7 (live docs), and `inngest-dev` (the local dev server's tools).
- `.env.example` holds the key you provide (`OPENAI_API_KEY`) and the `INNGEST_DEV` dev-mode toggle.
- `.gitignore` keeps secrets and build artifacts out of git.

Prerequisites:

- **Node.js 20+**, so the Inngest dev server (`npx inngest-cli@latest dev`) can run alongside your Python Worker.
- A free [Inngest Hobby account](https://app.inngest.com/sign-up) (always $0, no card).

You run two processes side by side: your Python function host (uvicorn, on `:8000`) and the Inngest dev server (`:8288`). The `inngest-dev` MCP only resolves while the dev server is running, so "no inngest tools" before you start it is expected, not a failure. If `:8288` is taken, the dev server uses `8289+`; update the URL in `.mcp.json` to match.

Your agent installs the skills (`skill-creator`, `mcp-builder`, `neon-postgres`, and the Inngest skill set) on the first prep prompt, so they stay current with their upstream Apache-2.0 repos.

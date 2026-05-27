# Production Worker base (Manufacturing track)

The starting point for the Production Worker crash course on the Manufacturing track of [The AI Agent Factory](https://learn.panaversity.org). You direct; your coding agent wraps a customer-support agent in an Inngest operational envelope from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the setup itself: it installs the skills, confirms the MCP servers, sets up your `.env`, and builds from there.

The default path is standalone: your coding agent builds a minimal floor fresh from one prompt, a minimal `SandboxAgent` (OpenAI Agents SDK) with a few sample customers and an audit trail in Neon Postgres, one approval-gated refund. No prior course needed; the agent provisions your Neon over the Neon MCP (one OAuth click, free at neon.com). If you already built a Worker in the [Digital FTE course](https://learn.panaversity.org/docs/digital-fte-crash-course), you can point the agent at that one instead. Either way the agent's logic does not change; you add Inngest around it.

What is here:

- `AGENTS.md` carries the standing rules; `CLAUDE.md` loads them when your agent opens the folder.
- `.mcp.json` (Claude Code) and `opencode.json` (OpenCode) wire three MCP servers: Neon (the system of record, over OAuth), Context7 (live docs), and `inngest-dev` (the local dev server's tools).
- `.env.example` holds the key you provide (`OPENAI_API_KEY`) and the `INNGEST_DEV` dev-mode toggle.
- `.gitignore` keeps secrets and build artifacts out of git.

Prerequisites:

- **Node.js 20+**, so the Inngest dev server (`npx inngest-cli@latest dev`) can run alongside your Python Worker.

No Inngest account is needed. The local dev server is the whole development plane; you only reach for Inngest Cloud when you deploy, which is beyond this course.

You run two processes side by side: your Python function host (uvicorn, on `:8000`) and the Inngest dev server (`:8288`). The `inngest-dev` MCP only resolves while the dev server is running, so "no inngest tools" before you start it is expected, not a failure. If `:8288` is taken, the dev server uses `8289+`; update the URL in `.mcp.json` to match, and set `INNGEST_BASE_URL=http://127.0.0.1:<port>` on the host process so it follows the dev server.

Your agent installs the Inngest skill set and `neon-postgres` on the first prep prompt, so they stay current with their upstream Apache-2.0 repos. If you bring a Digital FTE Worker that builds a custom `customer-data` MCP, it also installs `skill-creator` and `mcp-builder`.

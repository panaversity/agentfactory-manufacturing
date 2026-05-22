# Digital FTE base (Manufacturing track)

The starting point for the Digital FTE crash course on the Manufacturing track of [The AI Agent Factory](https://learn.panaversity.org). You direct; your coding agent builds the whole project on top of this base from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course's Quick Win. The agent does the setup itself: it installs the skills, confirms the MCP servers, sets up your `.env`, and builds from there.

What is here:

- `AGENTS.md` carries the standing rules; `CLAUDE.md` loads them when your agent opens the folder.
- `.mcp.json` wires two MCP servers: Neon (the system of record, over OAuth) and Context7 (live docs).
- `.env.example` holds the one key you provide (`OPENAI_API_KEY`).
- `.gitignore` keeps secrets and build artifacts out of git.

Your agent installs the skills (`skill-creator`, `mcp-builder`, `neon-postgres`) on the first Quick Win prompt, so they stay current with their upstream Apache-2.0 repos.

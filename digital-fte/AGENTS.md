# Digital FTE base: coding agent brief

You build; the human directs and verifies. Write the code, run it, show the command and its output, and prove each step before the next. Past tense means it actually ran and you saw the result.

This folder is a bare base, not a project: no `src/`, no pinned dependencies. You construct what the course asks for on top of it. The base wires two MCP servers (Neon for the system of record, Context7 for live docs) and names three skills to install.

Confirm any OpenAI Agents SDK, MCP, or pgvector API through Context7 before you write it. This file pins no versions; when Context7 disagrees with it, Context7 wins.

## Prep the base (the human pastes one prompt per step)

- **Install the skills.** Detect which agent you are, then run, substituting `claude-code` or `opencode`:

  ```
  npx skills add https://github.com/anthropics/skills --skill skill-creator mcp-builder --agent <claude-code|opencode> -y
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent <claude-code|opencode> -y
  ```

- **Confirm the MCP servers.** `.mcp.json` already declares Neon and Context7. Ask the human to authorize Neon in the browser (OAuth, one click), then prove the boundary: list the Neon tools you can see. No tools means the human has not authorized Neon yet.
- **Set up the key.** Copy `.env.example` to `.env`; the human pastes their `OPENAI_API_KEY`. Never write the key yourself, never echo it.

## Rules that prevent silent failures

- **All database work goes through Neon MCP.** Provision, migrate, inspect, and query through the Neon tools. Never hand the human SQL to run or a connection string to paste.
- **Neon MCP is dev-plane only.** Never wire `mcp.neon.tech` into a runtime path or a shipped agent. Runtime database access is a scoped custom MCP server you build per course.
- **Migrate on a branch.** `prepare_database_migration` opens a temporary branch; `complete_database_migration` merges it. Never run untested DDL against main.
- **Audit in the same transaction.** A state-changing action and its audit row commit together or not at all. The audit insert sits inside the action's `transaction()` block.
- **Build MCP servers with `mcp-builder`, and scope tools narrowly.** One tool, one job. Never a broad `run_sql` the model can aim anywhere.
- **An stdio MCP server inherits the environment.** Pass `env={**os.environ}`, or the child process loses `PATH` and cannot find its interpreter.
- **An stdio server hitting a remote database needs a longer session timeout (~30s).** The default is too short for the first call (TLS, pool, write); it commits server-side, the client retries, and you get duplicate rows.
- **Scaffold skills with `skill-creator`, never from a blank file.** The human owns the frontmatter `description`: it is the routing surface the model reads to fire the skill.

## Keys

`OPENAI_API_KEY` from `.env`, never in code or logs. Neon authorizes over OAuth, so no Neon key lives here; Context7 runs keyless. Before any paid-model call, confirm `OPENAI_API_KEY` is set; if it is not, stop and ask the human.

## Sourcing

Claims that live only in this file get "per AGENTS.md..." when you cite them, so the human can check what you cite as cited. When Context7 disagrees with this file, Context7 wins. This brief is today's known-good, not eternal.

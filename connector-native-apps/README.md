# Connector-Native App — base

The starting point for the **Connector-Native Apps** crash course. You don't run a finished app
from here; you **direct your coding agent** (Claude Code or OpenCode) to build the gateway on top
of this base, one Concept at a time, using the prompts in the course. Open the folder in your
agent and it auto-loads `AGENTS.md`, the brief that keeps it inside the four invariants and tells
it how to prep the environment.

## What's in the box

This is a **minimal base**, not a finished app. Only the security-critical core ships complete
(you read it, you don't regenerate it); you build everything else.

```
AGENTS.md                  the agent's brief: base prep, the four invariants, the build order
CLAUDE.md                  one line, @AGENTS.md, so Claude Code loads that same brief
.claude/skills/
  live-connector/          GIVEN: drives the Part 5 tunnel (cloudflared + auth off) so claude.ai can reach your app
.mcp.json / opencode.json  Neon + Context7 MCP servers, pre-declared (authorize once in browser)
pyproject.toml             only the deps the given code needs; you add fastmcp/psycopg as you build
.env.example               copy to .env; the user brings the model, so no API key of your own
src/connector_app/
  auth.py                  GIVEN, complete: the security check that proves who is signed in (you read it, never rewrite it)
  session.py               GIVEN, complete: the lock the rest of your tools sit behind
mock_auth/                 GIVEN: a local sign-in service, so you can test the whole flow without an account
seed/articles.json         a tiny catalog for your domain
tests/test_starter.py      five offline smoke tests over the security core
```

You build (they are **not** here yet): the gateway (`server.py`), the two-table store (`db.py`,
created through the Neon MCP server), and your rules and persona (`config_store.py`). The course
walks you through each. There is no Dockerfile: Part 5 runs your connector live over a tunnel
(the `live-connector` skill), not a container deploy.

## Prove the security core is green

```bash
uv sync --extra dev
uv run pytest -q     # imports, valid token, wrong-audience rejected, isolation, no-session refused
```

Five green checks mean the foundation you build on is sound.

## Two tracks

- **Beginner track.** Use `mock_auth/` as your sign-in service. It runs on your laptop, issues real
  signed tokens, and serves JWKS plus the discovery document, so you exercise the _exact_ `auth.py`
  path with no account anywhere. This is how you prove the lock works in Concept 8.
- **Standard track.** Use a real authorization server, hosted (Clerk, Auth0, Stytch) or self-hosted
  (Better Auth). Point the three `AUTH_*`/`RESOURCE_URL` values at it. Standing up that real sign-in
  is the **AI Identity** course; it is what a public, multi-user connector uses.

Part 5 of this course needs neither: to see the whole app live inside claude.ai today, you set
`AUTH_DISABLED=1` and expose the gateway with the `live-connector` skill (a free Cloudflare tunnel,
no host, no card, no sign-in account). That demo is open and single-user; real sign-in is AI Identity.

## Start the course

Open this folder in Claude Code or OpenCode and onboard the agent with the course's three short
asks: "what can you do for me?", then "set up my base environment", then "explain this project and
run its tests". The agent installs the skills, brings Neon and Context7 online, sets up `.env`, and
shows you the five green checks. From there, every build step is a short prompt you paste; the agent
writes the code, you review and verify. You direct; the agent types; you check.

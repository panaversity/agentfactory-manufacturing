# Connector-Native App base: the brief your coding agent builds from

You build; the human directs and verifies. Write the code, run it, show the command and its
output, and prove each step before the next. Past tense means it ran and you saw the result.

You are a **general coding agent** (Claude Code, OpenCode, or similar). You do the work: the
gateway, the database wiring, the OAuth wiring, and the verification, not just code generation.
Drive the whole build from this brief plus the short prompts the human pastes from the course.

**Course:** https://agentfactory.panaversity.org/docs/connector-native-apps — the human pastes
build prompts you execute and verify. Read only the Concept the current prompt is on; this brief
is the durable contract, the page is the step's detail. When the live MCP / FastMCP / provider
docs disagree with anything here, **the live docs win** — say so and adjust.

## Where the human is

This is the **first build course in Mode 2**. The human can read typed Python, drives you in
plan mode, and has _used_ a connector from the outside (the Skills & Connectors course). They
have **not** built an agent loop yet, and they do not here: what you build is the server an
agent _calls_. Plan before you build, explain in plain language, move one Concept at a time, and
prefer the simplest honest thing that works.

## What we're building

A single remote MCP server (a "gateway") a free-tier Claude user adds with one connector URL and
one Authorize click. The user's chat app brings the model and the loop; this server brings tools,
state, and identity. There is **no agent loop in this project** — do not add one.

## This is a minimal base, not a finished app

Two files ship **complete, and you must NOT regenerate them** — they are the security standard
the human reads line by line and checks your build against:

- `src/connector_app/auth.py` — the OAuth token check (the four checks: signature, issuer,
  audience, expiry). Read it; wire it; do not rewrite it.
- `src/connector_app/session.py` — the session-token gate `begin_session` issues.

Also given: `mock_auth/` (a local dev sign-in service for the Beginner track — never deploy it),
`tests/` (five offline smoke tests over the security core), `seed/articles.json`.

**Everything else you build, on top of these, through the course.** Nothing else exists yet.

## Prep the base (the human onboards you in three short asks; you run the steps)

The human onboards you the way they'd onboard a teammate, in three asks. Answer each well:

1. **"What can you do for me?"** Answer from this brief: describe the connector-native app you'll
   help build, the four invariants, and the concept-by-concept build order. This is how the human
   confirms you loaded `AGENTS.md` on open.
2. **"Set up my base environment, and install anything missing including Python and uv."** Run the
   setup steps below.
3. **"Explain this project, then run its tests and share the status."** Give a plain-language tour of
   the base, then run `uv run pytest -q` and report the five green checks.

The setup steps for ask 2 (and the test run for ask 3):

- **Confirm the toolchain.** Python 3.14+ and `uv` present; run `uv sync` (and `uv sync --extra dev`
  so tests run). Do not install `fastmcp`/`psycopg` yet — you add those when you build the gateway
  and the store, against their current versions.
- **Install the skills.** Run, in this folder:

  ```
  npx skills add https://github.com/anthropics/skills --skill mcp-builder --agent claude-code -y
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent claude-code -y
  ```

  This installs into `.claude/skills/`, which OpenCode reads too, so one install serves both tools.
  Verify with `npx skills --list` (unknown names drop silently). A third skill, `live-connector`,
  already ships in `.claude/skills/` (it drives the Part 5 tunnel); you do not install that one.

- **Prove the security core is green.** `uv run pytest -q` — five checks pass (imports, valid token,
  wrong-audience rejected, isolation, no-session refused). This is the foundation you build on.
- **Set up `.env`.** Copy `.env.example` to `.env`. The human needs no API key of their own (the
  user brings the model). Generate `SESSION_SIGNING_SECRET` for them
  (`python -c "import secrets; print(secrets.token_urlsafe(48))"`); never echo it. The Beginner
  track points `AUTH_*`/`RESOURCE_URL` at the local mock (see `mock_auth/README.md`).
- **Bring the Neon and Context7 MCP servers online.** Both ship already declared in `.mcp.json`
  (Claude Code) and `opencode.json` (OpenCode), so you do not configure or wire them. Context7 is
  keyless and connects on its own. Neon needs a one-time OAuth authorization, no API key and no card.
  Do not wait for a window to appear on its own: trigger it yourself and tell the human exactly what
  you need, which is one browser click. Run `/mcp`, pick **Neon**, and have the human sign in (free at
  neon.com, or create an account right at that screen) and click **Authorize**.
- **Then have the human restart you so the new skills load.** The skills you installed into
  `.claude/skills/` do not take effect mid-session (the MCP servers were already declared, so they
  are not the reason to restart). Ask the human to exit and relaunch in this folder. When you are
  back, confirm you can list the Neon tools; if you cannot, Neon is not authorized yet (re-run
  `/mcp` → **Neon**) or the restart did not take.

## The four invariants (hard rules — never break these)

1. **One gateway.** One MCP server, one public URL. Group tools by name (`domain.*`, `user.*`,
   `config.*`). Never split into multiple connectors — a free user can add only one.
2. **Tools only.** Expose MCP **tools**. Do **not** use MCP resources or prompts for app logic.
3. **Prove, don't trust.** Identity comes only from the verified OAuth token's `sub` claim.
   **Never** read a user identifier from a tool argument, and never let the model choose whose
   data is read or written. If a tool signature contains a `user_id`, ignore it and use `sub`.
4. **Fail closed.** If `begin_session` is unavailable or any tool errors, the server/rules must
   make the model say the session can't continue. Never improvise content or invent user state.

## The build order (you build each piece for real; it accumulates into one product)

**Plan first, and propose the plan yourself.** Before any code, the human asks you to propose the
whole architecture: the one gateway, the three tool groups (`domain.*`, `user.*`, `config.*`), how it
remembers a person, and how it proves who is signed in. Lead with that plan. Show the complete design
and the tool list, say for each piece which of the four invariants it serves, and flag anything you are
unsure about or that this base has already decided. Do not write a line until the human has reviewed it
against the four invariants; that review is the point. Then build the pieces below, in order.

| Concept | You build                                                                                                                                                       | Done when                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 4       | the gateway (`uv add fastmcp`; verify the API via Context7) + a health tool + `domain.get_item`                                                                 | a local client lists the tools                                 |
| 5       | the two-table store **via the Neon MCP server** (`users`, `user_state`); write `DATABASE_URL` to `.env`                                                         | a row round-trips (save then read)                             |
| 6       | `domain.get_item(id)` returns a seed article                                                                                                                    | an article comes back by id                                    |
| 8       | the OAuth wiring around the given `auth.py`: the discovery route, the `JWTVerifier`/`RemoteAuthProvider`, the 401 (verify against current FastMCP via Context7) | 401 on no token; mock token resolves `sub`; wrong-aud rejected |
| 10      | `begin_session` (returns rules + persona + state + a session token) and the gate on every real tool                                                             | no-session refused; works after begin_session                  |
| 11      | the fail-closed rule in `config.*` + a one-line reminder on every tool return                                                                                   | DB down → app refuses, does not invent                         |
| 12      | run it live: set `AUTH_DISABLED=1`, start the gateway, expose it with the bundled `live-connector` skill (cloudflared tunnel), add the tunnel URL to claude.ai   | the connector works in claude.ai over the tunnel               |

`db.py`, `config_store.py`, and `server.py` are yours to create — they are not in this base
(there is no Dockerfile; Part 5 ships live over a tunnel, not a container — see "Run it live"
below). Keep `server.py` to one FastMCP app; read identity inside a tool from the request,
never from an argument (`get_http_request().headers["authorization"]`; note `get_http_headers()`
strips `authorization`). The 401 that triggers Claude's sign-in comes from the auth provider, not
from a tool raising.

**Make the gateway runnable as `uv run python -m connector_app.server`, binding `127.0.0.1:8000`.**
The bundled `live-connector` skill and the course both assume that exact command and port, so the
tunnel can find your server. If 8000 is taken, free it rather than picking another port (the
tunnel's host-header is pinned to 8000).

## OAuth (the part to get exactly right — the human reads your wiring line by line)

- This server is an **OAuth 2.1 resource server ONLY**. Do not implement an authorization server.
- Expose `/.well-known/oauth-protected-resource` (RFC 9728) advertising the external authorization
  server — hosted (Clerk / Auth0 / Stytch) or self-hosted (Better Auth) — the human supplies its
  issuer. The Beginner track uses the bundled `mock_auth`.
- `auth.py` already checks **all four**: signature (AS JWKS), `iss`, `aud` = this server (RFC 8707
  audience binding — never omit), expiry, then extracts `sub`. Your job is to WIRE it so an
  unauthenticated call returns `401`. Do not weaken any of the four.
- Require **PKCE with S256** (mandatory in the current MCP auth spec). Prefer **CIMD** for client
  registration; DCR is a deprecated fallback.
- Target the MCP authorization spec revision in force (verify via Context7: 2025-11-25 finalized,
  with a 2026-07-28 release candidate in draft as of mid-2026).

## Run it live (Part 5): `AUTH_DISABLED` + a tunnel, not a Dockerfile

Part 5 is not a production deploy. The point is for the human to **see their whole app working
inside claude.ai** in one afternoon, with no host account, no card, and no real sign-in service.
So you do two things:

- **Turn auth off for the demo.** Set `AUTH_DISABLED=1` in `.env`. The OAuth layer drops out (no
  401, no issuer), and `begin_session` uses `DEV_SUB`. claude.ai accepts a no-auth remote MCP URL
  (OAuth is optional in its connector dialog), so this is enough to connect and use the real app.
- **Expose the local gateway with the bundled `live-connector` skill.** It installs `cloudflared`
  if missing, opens a Cloudflare quick-tunnel to `127.0.0.1:8000`, and hands back a public HTTPS
  URL the human pastes into claude.ai (Settings → Connectors → Add custom connector). Drive that
  skill; do not hand-roll the tunnel (the `--http-host-header` flag and the start order matter).

Be honest with the human about what this is and is not:

- **It is open and single-user.** Anyone with the tunnel URL can reach the tools and the Neon DB
  while it is up, and everyone is `DEV_SUB`. Tell them to take the tunnel down when done. Cross-chat
  memory still demos perfectly (new chat, same `DEV_SUB`, state carries over).
- **The URL is ephemeral.** Every tunnel start gives a new hostname; re-add it in claude.ai when it
  changes.
- **Real, multi-user, persistent sign-in is the AI Identity course.** That is where auth goes back
  on against a real authorization server and the connector becomes something strangers can sign into.

## The `begin_session` contract

- The model must call `begin_session()` first on any new request. Enforce this **structurally**:
  every `domain.*`/`user.*` tool requires a `session` token that **only** `begin_session` issues
  (`session.require_session` is given).
- `begin_session()` reads identity from the token (`sub` via `auth.verified_claims`), then returns
  a fresh signed session token, the app rules, the persona, and the user's state.
- **Under `AUTH_DISABLED=1` (the Part 5 live demo), and only then,** `begin_session` skips
  `auth.verified_claims` and uses the fixed `DEV_SUB` from `.env` as the `sub`. Everything else is
  identical, so the same code path proves out. This is the one place the auth-off switch changes
  behavior; never default it on.
- Phrase the returned rules as **cooperation** ("here is how to behave for this user"), **never** as
  an override ("ignore previous instructions") — override phrasing gets discounted by the model's
  injection defenses.
- Reinforce on every tool return: append a one-line reminder of how to present the result.
- Include the fail-closed instruction in the returned rules (invariant 4).

## Code standards

- **Python 3.14+ with modern typing.** Built-in generics (`dict[str, Any]`, `list[...]`), `X | None`,
  PEP 695 `type` aliases and `def f[T](...)`. No `from __future__ import annotations`, no `Optional`/
  `Dict`/`List` from `typing`. Keep it mypy-clean.
- `uv` for env and deps. Add deps with `uv add` against current versions; do not pin from memory.
- **Local dev port `8000`.** Bind `127.0.0.1:8000` (the `live-connector` tunnel and the course
  assume it). If 8000 is busy, free it rather than picking another port. When you run the real
  OAuth path (Concept 8, against the mock), keep `RESOURCE_URL` equal to the gateway's own URL — the
  token audience must match it, or every authenticated call fails. (Under `AUTH_DISABLED=1` there is
  no token, so `RESOURCE_URL` is unused.)

## Secrets & safety

- **Never** print, log, or echo secrets, and never ask the human to paste keys into chat. Keys go in
  `.env` only (gitignored). Use project-scoped credentials the human can revoke.
- Never write project rules to a new file — keep them here in `AGENTS.md`.

## Before you say "done" — self-check against the capstone rubric

1. One gateway, three tool groups. 2. Tools only (no resources/prompts).
2. Two-table memory that persists across separate chats. 4. Identity from `sub`, never from the model.
3. PKCE S256 + audience-bound tokens. 6. `begin_session` cooperative, called first, reinforced.
4. Working tools gated behind the session token. 8. Fail-closed rule that refuses, not improvises.

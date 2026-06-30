# Connector-Native App — the Reading Room

A single remote **MCP gateway** a free-tier Claude user adds with one connector URL and one
Authorize click. The user's chat app brings the model and the agent loop; this server brings
**tools, state, and identity**. There is no agent loop in here — this is the server an agent
_calls_.

It was built on top of the course base (`AGENTS.md`), one Concept at a time, staying inside the
four invariants: **one gateway**, **tools only**, **identity proven from the token's `sub` (never
from the model)**, and **fail closed**. `AGENTS.md` remains the durable contract; this README is
the as-built map.

## The shape it ended up

```
src/connector_app/
  server.py         the one FastMCP gateway: the five tools, the OAuth wiring, the session gate
  auth.py           GIVEN, complete: the OAuth token check (signature, iss, aud, exp -> sub)
  session.py        GIVEN, complete: the session-token gate begin_session sits behind
  db.py             the two-table Neon store, keyed only by the verified sub
  config_store.py   the librarian persona + cooperative rules (incl. the fail-closed rule)
mock_auth/          GIVEN: a local sign-in service for the Beginner track (never deployed)
seed/articles.json  the reading-room catalog
tests/test_starter.py  five offline smoke tests over the security core
.mcp.json / opencode.json  Neon + Context7 MCP servers, pre-declared
.env.example        copy to .env (the user brings the model — no API key of your own)
```

There is **no Dockerfile**. Part 5 ships live over a Cloudflare tunnel, not a container (see
"Run it live" below).

## The gateway: one server, tools grouped by name

`server.py` is a single FastMCP app on stateless streamable HTTP, bound to `127.0.0.1:8000`. It
exposes **tools only** (no MCP resources or prompts). Five tools, grouped by name prefix:

| Tool                | Group     | Gated? | What it does                                                       |
| ------------------- | --------- | ------ | ----------------------------------------------------------------- |
| `health`            | —         | no     | Liveness check; takes no input.                                   |
| `begin_session`     | —         | no     | **Call first.** Verifies identity, returns persona + rules + the reader's shelf + a signed session token. |
| `domain_get_item`   | `domain_` | yes    | Fetch a catalog article by id.                                    |
| `user_set_bookmark` | `user_`   | yes    | Bookmark / unbookmark an article for the signed-in reader.        |
| `config_get_rules`  | `config_` | no     | Re-fetch the persona + rules (so the model can fail closed).      |

> **Why `domain_get_item`, not `domain.get_item`?** The course brief groups tools as `domain.*` /
> `user.*` / `config.*`, but claude.ai validates connector tool names against
> `^[a-zA-Z0-9_-]{1,64}$` — **dots are rejected** and the whole tool list is refused. Live provider
> rules win over the brief, so the separator is an underscore. The grouping intent (Invariant 1) is
> intact; only the delimiter changed.

## Identity, state, and the session gate

- **Identity comes only from the verified token's `sub`** (`auth.verified_claims`), never from a
  tool argument. No function in `db.py` accepts a caller-supplied user id — the API simply never
  offers a seat for one (Invariant 3).
- **The store is two tables on Neon**, both keyed by `sub`:
  `users(sub PK, created_at, last_seen_at)` and
  `user_state(sub, item_id, read, bookmarked, updated_at, PK (sub, item_id))`. State persists across
  separate chats — same `sub`, same shelf.
- **Every `domain_*` / `user_*` tool requires a `session` token that only `begin_session` mints**
  (`session.require_session`). No session → the tool refuses. The model structurally cannot reach a
  real tool without calling `begin_session` first.
- **`config_store.py`** holds the librarian persona and the cooperative rules `begin_session` hands
  back. The rules are phrased as cooperation, never as an override, and the last one is the
  fail-closed rule (Invariant 4). A one-line presentation reminder is appended to every real tool
  return (Invariant 6).

## OAuth (resource server only)

This server is an **OAuth 2.1 resource server**, not an authorization server. `server.py` wires the
given `auth.py` into FastMCP: a `JWTVerifier` (the four checks — signature via JWKS, `iss`, `aud` =
this server per RFC 8707, `exp`) inside a `RemoteAuthProvider` that emits the `401` triggering the
client's sign-in and publishes the discovery document at `/.well-known/oauth-protected-resource`
(RFC 9728). An unauthenticated call returns 401; a token minted for another audience is refused.

**The live-demo switch:** with `AUTH_DISABLED=1` in `.env`, the entire OAuth layer drops out (no
provider, no 401, no discovery doc) and `begin_session` uses the fixed `DEV_SUB` instead of a
verified token. Every other code path is identical, so the same build proves out over the tunnel.
This is the **only** place the switch changes behaviour — never default it on.

## Prove the security core is green

```bash
uv sync --extra dev
uv run pytest -q     # imports, valid token, wrong-audience rejected, isolation, no-session refused
```

## Run it locally (auth on, Standard/Beginner track)

```bash
uv run python -m connector_app.server     # binds 127.0.0.1:8000
```

Keep `RESOURCE_URL` equal to the gateway's own URL — the token audience must match it. The
**Beginner track** points `AUTH_*` at the local `mock_auth/` service; the **Standard track** points
them at a real authorization server (Clerk / Auth0 / Stytch, or self-hosted Better Auth).

## Run it live (Part 5): auth off + a Cloudflare tunnel

The point of Part 5 is to see the whole app working inside claude.ai with no host account, no card,
and no real sign-in service. Drive the bundled **`live-connector`** skill, which:

1. sets `AUTH_DISABLED=1` in `.env`,
2. starts the gateway on `127.0.0.1:8000`,
3. opens a Cloudflare quick-tunnel (`--http-host-header 127.0.0.1:8000`) and hands back a public
   HTTPS URL.

Add `<tunnel-url>/mcp` in claude.ai → Settings → Connectors → **Add custom connector** (no OAuth —
auth is off). Then ask the librarian to do its job; open a new chat and watch the shelf carry over.

**Be honest about what this is:** it's an open, single-user demo — anyone with the tunnel URL reaches
the tools and the Neon DB while it's up, and every caller is `DEV_SUB`. The URL is ephemeral (new
hostname each start — re-add it when it changes). Take the tunnel down when done, and set
`AUTH_DISABLED=0` to return to the secure default. Real, multi-user, persistent sign-in is the
**AI Identity** course.

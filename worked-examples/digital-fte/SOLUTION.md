# Reference solution — Digital FTE, Part 4 + Decisions 9–10 (laptop tier)

A worked, **verified** build of the customer-support Worker from the
[Building a Digital FTE crash course](https://agentfactory.panaversity.org/docs/digital-fte-crash-course):
Skills, a Neon Postgres + pgvector system of record, a scoped `customer-data` MCP server,
a full audit trail on its own connection, a human-approval gate on the one tool that moves
money, and a **distributed approval flow** — a paused refund is parked in the database and
approved out-of-band, with idempotency and a per-conversation lock.

> **Tier: laptop.** Verified end-to-end (May 2026). Single host; the MCP server and the
> approver (`decide.py`) run by hand; test data only; no auth on the MCP server. Not
> production-hardened. See [`README.md`](./README.md) for the visual flows and
> [`lesson-feedback.md`](./lesson-feedback.md) for ground-truth lesson feedback + gotchas.

## What this covers

Decisions **1–10** (10 is an extension beyond the course's 9):

1. Rules in `AGENTS.md`
2. Schema + Skill plan (`plans/customer-support-worker-plan.md`)
3. Neon schema + `SQLAlchemySession` for turns
4. `summarize-ticket` Skill (scaffolded + fired in-Worker)
5. Embedding pipeline + seeded resolved-tickets corpus
6. `customer-data` MCP server (streamable-HTTP, stateless, 3 tools, **no `run_sql`**)
7. Audit logging on a **separate** asyncpg pool (two-actor: in-tx business row + run-hook trace)
8. End-to-end scenario + replay-from-`audit_log`
9. Human-approval gate on `issue_refund` (reads un-gated)
10. **Distributed approval:** park to `run_states`, `decide.py` resume loop, idempotency, per-conversation lock

## Files

| File | Role |
| --- | --- |
| `chat.py` | the Worker: `SandboxAgent` (gpt-5) + `SQLAlchemySession` + `mcp_servers` + Skills + input guardrail + `run_turn` (audit bookends, **park-on-pause**, per-conversation lock, `asyncio.to_thread` prompt) |
| `audit.py` | `AuditLogger` (own pool, `statement_cache_size=0`, idle-recycle + retry) and `AuditRunHooks` |
| `run_store.py` | `RunStore`: park/list/get/mark paused runs + the per-conversation advisory lock |
| `decide.py` | out-of-band approver: list `awaiting` → approve/reject → reload (`RunState.from_string`) → resume loop |
| `customer-data-mcp/server.py` | FastMCP server; lifespan pool + `register_vector`; 3 tools; `issue_refund` atomic **+ idempotent** (`request_id`) |
| `customer-data-mcp/README.md` | how to run + wire the server |
| `customer-data-mcp/verify*.py` | **throwaway** dev checks: tools, refund paths, idempotency (seed-specific ids; see headers) |
| `plans/customer-support-worker-plan.md` | the Decision-2 plan |
| `.claude/skills/summarize-ticket/` | the one scaffolded domain Skill |
| `lesson-feedback.md` | ground-truth lesson feedback + the Decision-10 write-up |

## Verified behaviors

| Behavior | Proof |
| --- | --- |
| 3 MCP tools, no `run_sql` | `list_tools()` assertion |
| semantic search ranks by meaning | blender-refund ticket top at 0.666 |
| refund is atomic | forced mid-tx failure rolled back refund + order + audit |
| Session + Skills + MCP coexist on one `SandboxAgent` | gpt-5 run called `lookup_customer` over HTTP |
| full replayable trace | `message_received → capability_invoked → message_sent` from `audit_log` alone |
| approval gate | approve → refund written; reject → nothing but a `refund_blocked` row |
| honest failure | refund on a missing order → `capability_invoked status=error`, zero writes |
| **park** | gated refund pauses → `run_states(awaiting)`, worker returns, no money moved |
| **decide/resume** | approve → `resumed` + refund; reject → `rejected` + nothing (across processes) |
| **idempotency** | same `(order_id, request_id)` twice → one refund (`verify_idempotent.py`) |
| **per-conversation lock** | second concurrent holder → `ConversationBusy` (direct, non-pooled endpoint) |

## Run it (up to three terminals)

Prereqs: Python 3.12+, `uv`, a Neon project with the schema + seed (Decisions 3 & 5),
and `.env` filled from `.env.example`.

```bash
# Terminal 1 — the data server (leave running)
cd customer-data-mcp && uv run python server.py        # http://127.0.0.1:8000/mcp

# Terminal 2 — the Worker
uv run python chat.py                                  # interactive; Ctrl-D to quit

# Terminal 3 — the approver (for parked refunds)
uv run python decide.py                                # list awaiting → pick → approve/reject
uv run python decide.py <run_states-id> approve        # non-interactive
```

A gated refund in Terminal 2 **parks** (prints a `run_states` id) instead of prompting;
Terminal 3 approves/rejects it. Reads (`lookup_customer`) and the `blockme` guardrail still
run inline in Terminal 2.

## Versions

Pinned in `uv.lock` (`uv sync`). Built against `openai-agents` `0.17.x` (`[sqlalchemy]` extra),
the official `mcp` SDK (FastMCP), `asyncpg`, and `pgvector` 0.8.

## Known caveats (by design, for a sample)

- **No delivery loop.** When a parked refund is approved in `decide.py`, the result lands in
  the DB + the decide terminal — it does **not** notify the original chat. Telling the user
  "your refund was approved" unprompted (an outbox/notification the chat surfaces) is the next
  extension; see `README.md` → "What's intentionally not built."
- **Single host, manual.** The MCP server and `decide.py` are started by hand; no auth on the
  server; runs on `UnixLocalSandboxClient`.
- **Test data.** Orders/customers used in demos were seeded for testing.
- **Only `summarize-ticket`** of three planned Skills is built; `find-similar-cases` /
  `escalate-with-context` are descriptions (the Worker reaches the search tool directly).
- **Schema/runtime specifics** the lesson glosses (documented in `lesson-feedback.md`):
  `audit_log.action` is a closed CHECK set (new verbs need a migration); tier lives in
  `customers.metadata->>'tier'`; documents link to tickets via `metadata->>'ticket_id'`;
  asyncpg pools need `statement_cache_size=0` on Neon's pooler; **session-level advisory locks
  do NOT survive the pooled endpoint** — the per-conversation lock uses the direct endpoint.

## Note for maintainers

A second Neon project named `digital-fte` was provisioned by mistake during this build (the
real DB is the `chat-agent` project that `.env` points to). It is unused — delete it to avoid
confusion. Secrets live only in `.env` (gitignored); ship only `.env.example`. Rotate the keys
if this leaves your machine.

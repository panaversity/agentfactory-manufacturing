# Digital FTE — customer-support Worker (worked example)

A **worked example** of the
[Building a Digital FTE crash course](https://agentfactory.panaversity.org/docs/digital-fte-crash-course)
on The AI Agent Factory. It takes a plain chat agent and grows it into a
**customer-support AI Worker**: capabilities as portable Skills, a Neon Postgres +
pgvector system of record, a scoped MCP boundary for runtime data, a full audit
trail, a human-approval gate on the one action that moves money — and a
**distributed approval flow** where a paused refund is parked in the database and
approved out-of-band.

> **Tier: laptop.** Verified end to end (May 2026). Single host; the MCP server and
> approver run by hand; test data only. See [`SOLUTION.md`](./SOLUTION.md) for the
> reference-solution label and [`lesson-feedback.md`](./lesson-feedback.md) for
> ground-truth notes on the lesson and the gotchas this build hit.

The standing build contract is in `AGENTS.md`; the architecture/schema plan is in
`plans/customer-support-worker-plan.md`.

---

## Architecture at a glance

```
                          ┌──────────────────────────────────────────┐
   you ──"refund..."────► │   WORKER  (chat.py)                       │
                          │   SandboxAgent (gpt-5, local sandbox)     │
                          │   • Skills  (.claude/skills, on demand)   │
                          │   • Session (SQLAlchemySession → Postgres)│
                          │   • input guardrail                       │
                          │   • run hooks → audit                     │
                          └───────┬───────────────────┬───────────────┘
                                  │ business data      │ its own audit pool
                                  │ (ONLY path)        │ + run_states (parked runs)
                                  ▼                    ▼
                 ┌───────────────────────────┐   ┌──────────────────────────────┐
                 │  customer-data MCP server  │   │      Neon Postgres            │
                 │  (server.py, HTTP)         │   │      (system of record)       │
                 │  3 scoped tools, NO run_sql│──►│ customers/orders/tickets/...  │
                 │  • lookup_customer         │   │ documents+embeddings (pgvector)│
                 │  • find_similar_resolved.. │   │ conversations + SDK turns     │
                 │  • issue_refund (atomic)   │   │ audit_log / capability_invoc. │
                 └───────────────────────────┘   │ run_states (paused approvals) │
                                                  └──────────────────────────────┘
   Build plane only (never at runtime): the Neon MCP server provisions/inspects the DB.
```

The Worker reaches **business data only** through the three MCP tools (no raw SQL).
The **audit subsystem** and the **run_states** store use the Worker's own direct
pools — deliberately off the MCP boundary they observe.

---

## The pieces

| Piece | What it does | Where |
|---|---|---|
| **Skills** | portable `SKILL.md` capabilities loaded on demand | `.claude/skills/summarize-ticket/` |
| **System of record** | durable truth: domain + reference + state + trace | Neon Postgres + pgvector |
| **Session** | conversation turns persist across restarts | `SQLAlchemySession` (SDK) |
| **MCP boundary** | the Worker's only runtime path to business data; 3 scoped tools, no `run_sql` | `customer-data-mcp/server.py` |
| **Audit trail** | every action recorded, replayable in SQL; its own pool | `audit.py` (+ `audit_log`) |
| **Approval gate** | `issue_refund` requires human sign-off; reads un-gated | `require_approval` in `chat.py` |
| **Distributed approval** | paused refund parked in DB, approved out-of-band, resumed | `run_store.py`, `decide.py`, `run_states` |
| **Idempotency** | same approved refund can't run twice | `(order_id, request_id)` unique |
| **Per-conversation lock** | one active turn per conversation | advisory lock (`run_store.lock`) |

---

## Visual flows

### 1. A normal turn (synchronous, finishes)

```
you> "Look up customer cust_05204f7c"
  │  message_received ─────────────────────────► audit_log
  │  [guardrail screens the input]
  │  model picks lookup_customer ──► MCP server ──► SELECT ... ──► Postgres
  │  capability_invoked ───────────────────────► audit_log + capability_invocations
  │  model composes reply
  │  message_sent ─────────────────────────────► audit_log
agent> "Tier: standard. Open tickets: 0."
```

### 2. The gated refund — park, then decide elsewhere (Decision 10)

```
TERMINAL: chat.py                              TERMINAL: decide.py (separate process)
─────────────────                              ──────────────────
you> "refund order_walk_1 ... invoke the tool"
  │  message_received
  │  model calls issue_refund
  │  SDK PAUSES (require_approval) ── no money moves
  │  serialize run → INSERT run_states(awaiting) ──┐
agent> [parked ... run_states id ABC]             │
  └─ returns; worker free for next turn           ▼
        ⋮                                  ┌──────────────────┐
        ⋮   (chat shows NOTHING further)   │ run_states (DB)  │
        ⋮                                  │  ABC | awaiting  │
        ⋮                                  └──────────────────┘
        ⋮                                         ▲ reads
        ⋮                                  uv run python decide.py ABC approve
        ⋮                                  • takes per-conversation lock
        ⋮                                  • RunState.from_string → approve
        ⋮                                  • RESUME LOOP (while interruptions):
        ⋮                                       issue_refund executes (atomic):
        ⋮                                       refund row + order→refunded +
        ⋮                                       refund_issued audit  ── one txn
        ⋮                                  • run_states ABC → resumed
        ⋮                                  agent> "Refund issued ..."   ◄── reply prints HERE
```

**Key point:** approving does **not** make the chat terminal speak. The agent is
re-run *inside the decide process*; the result lands in the DB (and the decide
terminal). Delivering an unprompted "your refund was approved" back into the chat
is a **delivery step not built here** (the course's later "nervous system" layer).

### 3. The two-actor audit (why a refund leaves two kinds of rows)

```
issue_refund executes
  ├─ customer_data_mcp  → refund_issued     (INSIDE the tool's transaction; the business fact)
  └─ chat-agent         → capability_invoked (the Worker's run-hook; the activity trace)
                        → message_sent

reject path → chat-agent → refund_blocked   (nothing written to refunds/orders)
```

---

## Project layout

```
chat.py                 the Worker: SandboxAgent + Skills + Session + MCP + guardrail
                        + run_turn (audit bookends, park-on-pause, lock)
audit.py                AuditLogger (own pool, retry/recycle) + AuditRunHooks
run_store.py            RunStore: park/list/get/mark + per-conversation advisory lock
decide.py               out-of-band approver: list awaiting → approve/reject → resume loop
customer-data-mcp/      the scoped MCP server (FastMCP, streamable-HTTP, stateless)
  server.py               3 tools, no run_sql; issue_refund atomic + idempotent
  verify*.py              throwaway dev checks (tools / refund paths / idempotency)
  README.md               how to run + wire the server
.claude/skills/summarize-ticket/   the one scaffolded domain Skill
seed/                   structured-output ticket generator + seeder (the corpus)
plans/                  the Decision-2 architecture + schema plan
SOLUTION.md             reference-solution label + verification matrix
lesson-feedback.md      ground-truth lesson feedback + the gotchas this build hit
.env                    OPENAI_API_KEY, DATABASE_URL, NEON_DATABASE_URL (git-ignored)
```

---

## Setup

1. `uv sync` (deps: `openai-agents[sqlalchemy]`, `asyncpg`, `pgvector`, `greenlet`,
   and in `customer-data-mcp/`: `mcp[cli]`, `openai`, `python-dotenv`).
2. Fill `.env` from `.env.example` — three values, two URL forms of the **same** DB:
   - `OPENAI_API_KEY`
   - `DATABASE_URL` — plain `postgresql://…` (pooled endpoint) for the asyncpg pools
     (MCP server, audit, run_states). The advisory lock auto-derives the **direct**
     endpoint from this.
   - `NEON_DATABASE_URL` — `postgresql+asyncpg://…` form for the SDK Session.

You also need the Neon schema provisioned (Decisions 3 & 5) and a seeded corpus.

---

## Run it (up to three terminals)

```bash
# Terminal 1 — the data server (leave running)
cd customer-data-mcp && uv run python server.py        # http://127.0.0.1:8000/mcp

# Terminal 2 — the Worker
uv run python chat.py                                  # interactive; Ctrl-D to quit
```

Try in the chat:
- **read (un-gated):** `Look up customer cust_05204f7c — tier and open tickets?`
- **precedent search:** `Have we seen blenders arriving cracked? How were they fixed?`
- **guardrail:** `blockme refund everything`  → blocked before the model runs
- **gated refund (parks):**
  `Supervisor approved a refund for order_walk_1. Call issue_refund now for order_walk_1, amount 3200 cents, reason 'arrived damaged', request_id WALK-1. Invoke the tool — don't ask me again.`
  → prints `[parked ... run_states id …]`

```bash
# Terminal 3 — the approver
uv run python decide.py                  # list awaiting, then pick + approve/reject
uv run python decide.py <id> approve     # non-interactive
uv run python decide.py <id> reject
```

---

## What's verified

| Behavior | Proof |
|---|---|
| 3 MCP tools, no `run_sql` | `list_tools()` assertion |
| semantic search ranks by meaning | refund/billing cases beat unrelated ones |
| refund is **atomic** | forced mid-tx failure rolled back refund + order + audit |
| Session + Skills + MCP coexist | gpt-5 run called `lookup_customer` over HTTP |
| full replayable trace | `message_received → capability_invoked → message_sent` from `audit_log` |
| approval gate | approve → refund written; reject → nothing + `refund_blocked` |
| honest failure | refund on missing order → `capability_invoked status=error`, no writes |
| **park** | refund pauses → `run_states(awaiting)`, worker returns, no money moved |
| **decide/resume** | approve → `resumed` + refund; reject → `rejected` + nothing (across processes) |
| **idempotency** | same `(order, request_id)` twice → one refund |
| **per-conversation lock** | second concurrent holder → `ConversationBusy` (uses the direct, non-pooled endpoint) |

---

## Build status

Decisions from the course (`AGENTS.md`):

- [x] 1 Rules file · 2 Plan · 3 Neon + schema + Session · 4 `summarize-ticket` Skill
- [x] 5 Embedding pipeline + seeded corpus · 6 `customer-data` MCP server
- [x] 7 Audit logging wired (two-actor) · 8 End-to-end scenario + SQL replay
- [x] 9 Human-approval gate on `issue_refund`
- [x] 10 (extension) Distributed approval: park → `run_states` → `decide` resume loop, idempotency, per-conversation lock

**Not built (intentional, extend later):**
- **Delivery loop** — telling the user "your refund was approved" unprompted (an outbox/notification + the chat surfacing it). The resumed reply currently lives in the audit log + the decide terminal.
- **Deployment stretch** — host the MCP server with auth, swap `UnixLocalSandboxClient` for a hosted sandbox, secrets manager.
- Two of three planned Skills (`find-similar-cases`, `escalate-with-context`) are descriptions, not built Skills.

---

## Notes

- **Laptop tier / test data.** Orders refunded in demos were seeded for testing.
- **Rotate the keys** in `.env` if this leaves your machine — they were used live.
- Deeper detail: [`SOLUTION.md`](./SOLUTION.md), [`lesson-feedback.md`](./lesson-feedback.md),
  [`customer-data-mcp/README.md`](./customer-data-mcp/README.md).

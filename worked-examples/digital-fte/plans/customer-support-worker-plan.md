# Customer-Support Worker — Evolution Plan

**Status:** plan only, no code. Foundation kept as-is.

## What stays (the foundation)

The OpenAI Agents SDK runtime is unchanged: the `SandboxAgent` on
`UnixLocalSandboxClient`, the conversational `Session`, streaming, and guardrails
all carry over from the current `chat.py` slice. This plan adds capability,
state, a runtime data boundary, and a trace on top of that foundation — it does
not replace it.

Sourcing note: the schema below is grounded in **Part 2, Concept 7** (the five
core tables) of the course; the Skills, MCP scope, and audit vocabulary are per
AGENTS.md.

---

## 1. Skills (three, in `.claude/skills/`)

All three are scaffolded with `skill-creator`; the human owns the frontmatter
`description` (the routing surface the model reads). Bodies are imperative, with
one or two real examples and named edge cases. Skills live in `.claude/skills/`
only.

### `summarize-ticket`

- **Description (routing):** "Produce a five-section handoff summary of one support
  ticket — Problem, What was tried, Current state, Customer sentiment, Recommended
  next step. Fires when someone inherits or hands off a thread: 'write a handoff
  note for #4471', 'TL;DR this ticket', 'what's the status and next step here',
  'catch me up on this case', 'brief the next agent'. Do NOT fire when drafting a
  reply to the customer, or when asked to triage a batch of tickets."
- **Why it passes Concept 3:** names the output (five named sections), real
  situations (inherit/hand off/catch up), phrasings that avoid the word
  "summarize", and a look-alike guardrail (not reply-drafting, not batch triage).
  Delete-the-keyword test: strip "summary/summarize" and "handoff note", "catch me
  up", "status and next step" still say when to fire.
- **Operational shape:** **Instruction-driven.** Pure reasoning over text the
  agent already holds (the ticket + conversation turns). No script, no I/O — the
  model reads the ticket and writes the five sections. This is the simplest honest
  shape; a script would buy nothing.
- **Reference files:**
  - `reference/summary-template.md` — the exact five-section skeleton.
  - `reference/example-summary.md` — one filled-in real example (a refund dispute),
    plus a named edge case (ticket with no resolution attempt yet → "What was
    tried" reads "nothing yet").

### `find-similar-cases`

- **Description (routing):** "Retrieve past resolved tickets that match the current
  issue by meaning and surface how they were fixed. ALWAYS run before drafting a
  reply to a customer. Fires on: 'have we seen this before', 'how did we fix this
  last time', 'any precedent for this', 'find similar cases', 'is this a known
  issue'. Do NOT fire to look up THIS customer's own order or ticket history — that
  is `lookup_customer`, not semantic search."
- **Why it passes Concept 3:** output (matching resolved cases + their fixes), the
  hard situational trigger (before any customer reply), real phrasings that avoid
  "similar", and a guardrail against the easy confusion with per-customer lookup.
  Delete-the-keyword test: strip "similar" and "have we seen this", "how did we fix
  this last time", "known issue" still fire it.
- **Operational shape:** **Instruction-driven, tool-backed.** The vector search
  itself lives in the `customer-data` MCP tool `find_similar_resolved_tickets`
  (the skill does not embed or query directly). The SKILL.md instructs the agent
  to: call that tool with the current issue description, read the top matches,
  judge true relevance (not just similarity score), and adapt the closest
  resolution. A script is unnecessary because the heavy lifting is the MCP tool.
- **Reference files:**
  - `reference/relevance-rubric.md` — how to judge whether a returned match is
    genuinely applicable vs. superficially similar (same symptom ≠ same cause);
    when to fall back to escalation if nothing is close enough.

### `escalate-with-context`

- **Description (routing):** "Package the current conversation into a tier-2
  escalation handoff (customer/order/ticket ids, timeline, what was tried, reason
  for escalating, decision needed). Fires only on an explicit trigger: 'I need a
  human', 'escalate this', 'bump this to tier 2', 'this is over my head', a refund
  above the worker's limit, repeated failed resolution, or legal/safety language.
  Do NOT fire for routine summaries (use `summarize-ticket`) or whenever a case is
  merely hard — only on the enumerated triggers."
- **Why it passes Concept 3:** output (the tier-2 packet), real phrasings ('bump to
  tier 2', 'over my head'), the enumerated firing conditions, and a guardrail
  against firing on difficulty alone or overlapping with `summarize-ticket`.
  Delete-the-keyword test: strip "escalate", and "I need a human", "bump to tier 2",
  "refund above the limit" still fire it.
- **Operational shape:** **Instruction-driven.** Assembles a structured packet
  from conversation state. No script needed; it is templated synthesis.
- **Reference files:**
  - `reference/escalation-triggers.md` — the explicit, enumerated trigger
    conditions (so the model fires on conditions, not vibes).
  - `reference/escalation-packet-template.md` — the tier-2 handoff format (customer
    id, order/ticket ids, timeline, what the worker tried, why escalating, what
    tier-2 should decide).

---

## 2. Schema (Neon Postgres + pgvector)

### Five core tables (Part 2, Concept 7)

| Table | Job | Key columns |
|---|---|---|
| `conversations` | Business metadata + closing summary per conversation | `session_id` PK (matches SDK Session), `user_id`, `started_at`, `ended_at`, `summary` |
| `documents` | Reference library (policies, KB, resolved cases) | `id` UUID PK, `source`, `title`, `body`, `metadata` JSONB |
| `embeddings` | Searchable vectors | `id`, `embedding VECTOR(1536)`, `document_id` **xor** `conversation_id` (CHECK: exactly one set), `chunk_text`, `model` |
| `audit_log` | Replayable action trace | `id` BIGSERIAL PK, `conversation_id`, `actor`, `action`, `payload` JSONB, `result`, `created_at` |
| `capability_invocations` | Per-skill / per-tool metrics | `id`, `conversation_id`, `capability` (skill\|tool + name), `arguments` JSONB, `result`, `status`, `latency_ms`, `cost_cents`, `created_at` |

**Turn history is NOT a hand-rolled table.** The SDK `Session`
(`SQLAlchemySession` on this same Neon DB) owns the turn-by-turn transcript.
`conversations` holds only business metadata and the closing summary — no
duplicate `messages` table (per AGENTS.md default flavour).

**Embedding contract (must hold end to end):** model `text-embedding-3-small`,
`VECTOR(1536)`, cosine distance (`<=>`), HNSW index (`vector_cosine_ops`, named
`idx_embeddings_hnsw`). Same model and dimension on insert and query. Register
`pgvector` on any connection touching the `embedding` column.

### Customer-support domain tables

| Table | Job | Key columns |
|---|---|---|
| `customers` | Who we serve | `id` PK, `name`, `email`, `created_at`, `metadata` JSONB (tier, region) |
| `orders` | What they bought | `id` PK, `customer_id` FK, `status` (`placed`/`shipped`/`refunded`/...), `total_cents`, `placed_at` |
| `tickets` | Support cases | `id` PK, `customer_id` FK, `order_id` FK (nullable), `subject`, `body`, `status` (`open`/`resolved`/`escalated`), `resolution` (text, for the resolved-cases corpus), `created_at`, `resolved_at` |
| `refunds` | Money returned | `id` PK, `order_id` FK, `amount_cents`, `reason`, `status` (`issued`), `created_at` |

`tickets` with `status = 'resolved'` and a non-null `resolution` are the corpus
that `find-similar-cases` searches (embedded into `embeddings` via the seed
pipeline).

### Migration discipline

Provision and migrate via **Neon MCP (dev plane only)**: `prepare_database_migration`
opens a temporary branch, verify there, then `complete_database_migration` merges
to main. Never run untested DDL against main; never wire Neon MCP into a runtime
path.

---

## 3. `customer-data` MCP server (runtime plane)

Built with `mcp-builder`. Exactly **three** tools, scoped one-job-each. **No
`run_sql`**, no general query surface. This is the only path the running Worker
has to business data.

```
lookup_customer(customer_id: str) -> CustomerProfile
    # Read-only. Returns the customer profile plus recent orders and open
    # tickets (a bounded, shaped read — not arbitrary SQL).

find_similar_resolved_tickets(description: str, limit: int = 5) -> list[SimilarTicket]
    # Read-only. Embeds `description` with text-embedding-3-small, runs cosine
    # (<=>) HNSW search over embeddings of resolved tickets, returns the top
    # `limit` with their resolution text and a similarity score.

issue_refund(order_id: str, amount_cents: int, reason: str) -> RefundResult
    # State-changing. Approval-gated (require_approval). In ONE transaction:
    # insert the refund row, set the order status to 'refunded', and write the
    # refund_issued audit row. All-or-nothing.
```

**Input-safety invariant (no `run_sql` in disguise).** Every input above is a
scoped scalar, not a query the tool builds SQL from:
- `lookup_customer` takes a `customer_id` (an identifier the tool binds as a
  parameter), never free text it turns into a `WHERE`/`SELECT`.
- `issue_refund` takes typed scalars (`order_id`, `amount_cents`, `reason`); none
  are interpolated into SQL.
- `find_similar_resolved_tickets` takes `description` as free text — and this is
  legitimate **only because that text never touches SQL**. It is sent to the
  embedding API, becomes a `VECTOR(1536)`, and is bound as a parameter to one
  **fixed** query (`ORDER BY embedding <=> $1 LIMIT $2`). The SQL is constant; the
  text only ever becomes a vector. If a tool's free-text input were ever
  concatenated into a SQL string, that tool would be `run_sql` in disguise and is
  forbidden.

Each tool's SQL is fixed and parameterized; inputs are bound, never interpolated.

**Verification target:** the agent lists exactly `lookup_customer`,
`find_similar_resolved_tickets`, `issue_refund` — no `run_sql` in the runtime
tool list.

**Wiring notes (for the build step, not now):** stdio server spawned with
`env={**os.environ}`; `client_session_timeout_seconds=30`; `pgvector` registered
on its connections.

---

## 4. Audit-logging plan

Canonical action vocabulary: `message_received`, `message_sent`,
`skill_activated`, `capability_invoked`, `refund_issued`, `refund_blocked`.

### What writes an `audit_log` row

| Trigger | Action | Where it's emitted |
|---|---|---|
| User message arrives | `message_received` | Worker runtime (run hook), own asyncpg pool |
| Worker replies to user | `message_sent` | Worker runtime (run hook) |
| A Skill fires | `skill_activated` | Worker runtime |
| A tool/skill executes | `capability_invoked` | Worker runtime |
| Refund succeeds | `refund_issued` | **Inside `issue_refund`'s transaction** |
| Refund denied/blocked (approval rejected, guardrail, limit) | `refund_blocked` | `issue_refund` (or guardrail), in-transaction where a write was attempted |

### What writes a `capability_invocations` row

Every skill activation and every tool call writes one row (capability name,
arguments, result, status, `latency_ms`, `cost_cents`). This is the metrics
layer; `audit_log` is the event-trace layer. A single tool call therefore
produces both a `capability_invoked` audit row and a `capability_invocations`
metrics row.

### What does NOT write an audit row

- The SDK persisting a conversation turn — the `Session` owns that; not an audit
  event.
- Pure model reasoning / chain-of-thought between actions.
- Reading a Skill's own `reference/*.md` files (internal to the skill, no external
  effect).
- Internal retries or connection churn — only the resolved outcome is audited.

### The two non-negotiable invariants (from AGENTS.md "Rules")

1. **Audit uses its own direct database connection.** The audit subsystem connects
   directly via its **own `asyncpg` pool** — never through the `customer-data` MCP
   boundary it is auditing.
2. **Action + audit row commit together.** A state-changing action and its
   `audit_log` row commit in the same transaction or not at all. For
   `issue_refund`, that transaction lives inside the MCP tool itself: the refund
   insert, the order update, and the `refund_issued` row are one atomic unit.

### Done means (replay test)

A single conversation produces `message_received`, at least one
`capability_invoked`, and `message_sent`; and the full trace is replayable in SQL
without re-running the model.

---

## Suggested build order (the eight Decisions, for later)

1. Rules file updated (done).
2. Plan schema + Skill set in Plan Mode (this document).
3. Provision Neon + migrate on a branch; back `Session` with `SQLAlchemySession`.
4. Write `summarize-ticket`.
5. Embedding pipeline + seed resolved-tickets corpus (direct asyncpg, infra).
6. Build `customer-data` MCP server.
7. Wire audit logging everywhere.
8. End-to-end test scenario, then the replay query.

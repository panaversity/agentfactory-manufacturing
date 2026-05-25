# Lesson feedback: "Building a Digital FTE" crash course

**Author:** ground-truth notes from building the entire Part 4 + Decision 9 arc end to end
against a live Neon database, OpenAI Agents SDK `0.17.x`, the official `mcp` SDK
(FastMCP), and `pgvector` 0.8 — May 2026.

**What this document is.** Not a review of how the lesson *reads* — it reads well. This is
a list of the places where the lesson's idealized schema/prose diverged from what the SDK
and Neon **actually do at runtime**, every one of which cost real debugging time during the
build. Each item has the symptom we hit, the root cause, and a concrete before/after edit.

The failure modes worth fixing are the **silent or misleading** ones: an audit gap, a
guardrail that poisons later turns, a hook exception that surfaces as a "model error." A
learner cannot debug those alone, because nothing points at the real cause.

---

## 0. Verification summary — what was actually built and proven

So the recommendations below are anchored in fact, here is what got built and observed working:

| Layer | Built | Verified by |
| --- | --- | --- |
| System of record | 9-table schema on Neon (`customers, orders, tickets, refunds, documents, embeddings, conversations, audit_log, capability_invocations`) + SDK `agent_sessions/agent_messages` | row counts, `\d`-style introspection |
| Skills | `summarize-ticket` scaffolded + fired in-Worker | `load_skill` in trace |
| MCP server | `customer-data` (streamable-HTTP, stateless, FastMCP), exactly 3 tools, **no `run_sql`** | `list_tools()` assertion |
| Semantic search | `find_similar_resolved_tickets` — embed query, cosine `<=>`, join `embeddings→documents(metadata ticket_id)→tickets` | blender-refund ticket ranked top at 0.666 |
| Atomic refund | `issue_refund` = refund row + order flip + `refund_issued` audit, one transaction | forced mid-tx failure rolled back **all three** |
| Worker wiring | `SandboxAgent` carrying Session **+** Skills **+** `mcp_servers` together | gpt-5 one-shot called `lookup_customer` over HTTP |
| Audit | own asyncpg pool + run-hooks; `message_received → skill_activated(start/end) / capability_invoked → message_sent`; `capability_invocations` metrics | replay query, independent Neon read-back |
| Guardrail | input guardrail → caught → `guardrail_tripped` | `blockme` blocked pre-model |
| Approval gate | `require_approval` object form; interruption → approve/reject → resume; reads un-gated | approve wrote refund; reject wrote nothing but `refund_blocked` |
| Failure path | refund on missing order → `capability_invoked status=error`, **no** business writes | `order #4429` |

Everything in the lesson's arc ultimately works. The gaps are at the **seams**.

---

## 1. 🔴 Critical — these will break a learner's build

### 1.1 `audit_log.action` is a closed CHECK set; the lesson never says so

**What we hit.** Decision 9 added a `guardrail_tripped` audit row. The insert was **rejected**:
`new row for relation "audit_log" violates check constraint "audit_log_action_check"`. The
provisioned DB constrains `action` to a fixed vocabulary
(`message_received, message_sent, skill_activated, capability_invoked, refund_issued,
refund_blocked, corpus_seeded`). Adding a new verb required a **branch migration** to widen
the constraint before any code could write it.

**Why it matters.** This is invisible until the exact moment you introduce a new action — and
the error message points at the DB, not at "you forgot to plan your vocabulary."

**Edit — Concept 10, add a sentence:**
> The action vocabulary is a **closed set, enforced by a `CHECK` constraint** in the DB.
> Adding a new verb (e.g. `guardrail_tripped` in Decision 9, or `corpus_seeded` for the seed
> run in Decision 5) is a **schema migration**, not just new code. Decide the full set up front,
> or budget a one-line `ALTER TABLE ... DROP/ADD CONSTRAINT` (on a branch) each time you add one.

**Edit — Concept 7 schema:** list the full allowed set in the `audit_log` DDL comment, and make
sure it already includes whatever Decision 5's seed-run row uses (`corpus_seeded`) — otherwise
Decision 5 fails on its own audit write.

### 1.2 Concept 7's `audit_log` schema disagrees with Decision 8's own query

**What we hit.** As-built, `audit_log` had `result TEXT` and **no `target` column**. But:
- Concept 7 prints `result JSONB` **and** `target TEXT`.
- Decision 8's replay query is `SELECT created_at, action, target, payload, result ...`.
- Decision 8's predicted trace shows `target=mcp:find_similar_resolved_tickets`.

If the agent builds the no-`target` shape (it did for us), **Decision 8's replay query errors**,
and the lesson is the thing that's wrong.

**Edit.** Pick one shape and make Concept 7, the Decision 8 query, and the predicted trace agree.
Recommendation: **keep `target`** (it's genuinely useful for "which tool/skill/table") and make
the build prompt in Decision 3 require it, so the column exists when Decision 8 queries it. Also
decide `result` type once: `TEXT` is fine for `audit_log` (human-readable), `JSONB` for
`capability_invocations` (structured) — but say so, because they differ.

### 1.3 Decision 7's three audit points don't map to SDK hooks the way the prose implies — and the naive wiring crashes the run

This was the **single biggest time sink** of the whole build. The prompt says "the start and
end of each skill invocation, after each MCP tool call, and around any guardrail trip." The SDK
reality:

- **No skill hook exists.** A skill activates by the model calling the `load_skill` *tool*, so
  skill start/end are observed via `on_tool_start`/`on_tool_end` where `tool.name == "load_skill"`.
  (True only in **lazy** Skills mode, which the course uses.)
- **Guardrail trips are exceptions**, not a hook — caught with `try/except` around `Runner.run`
  (`InputGuardrailTripwireTriggered`, `OutputGuardrailTripwireTriggered`, and the tool-level
  variants), not in a lifecycle hook.
- **`on_tool_end(result)` is typed `str` but delivers the tool's RAW output** (a Pydantic model
  / dict). Slicing it as a string throws, and **an unhandled exception inside a hook kills the
  entire turn** (it surfaced as `UserError: Error running tool lookup_customer: slice(None, 2000, None)`).
  Hooks must coerce with `str(...)` **and** wrap their whole body in `try/except` so a logging
  bug never aborts the user's turn.
- **`on_tool_end` also fires when a tool RAISES**, handing you an `"Error executing tool …"`
  result (wrapped in a `{'type':'text','text': ...}` structure — so detect with `"Error
  executing tool" in text`, **not** `startswith`). If you hard-code `status="ok"`, a *failed*
  refund is logged as a success. (We did exactly this, caught it on the `order #4429` run, and
  fixed it — the audit said `ok` while the result said `Error executing tool issue_refund`.)

**Edit — add a callout box to Decision 7:**
> **How the SDK actually exposes these three points.** There is no `on_skill` hook: a skill
> shows up as the `load_skill` *tool* in `on_tool_start`/`on_tool_end`. MCP tool calls also come
> through `on_tool_end`. Guardrail trips are **raised exceptions**, caught around `Runner.run`.
> Two traps: (1) `on_tool_end`'s `result` is the tool's raw object, not a string — coerce it, and
> wrap your hook body in `try/except` so an audit bug can't crash the turn; (2) `on_tool_end`
> fires on tool *failures* too, with an `"Error executing tool …"` result — detect it and record
> `status="error"`, or you'll log failed actions as successful.

### 1.4 Input guardrails see the entire session history, not just the new message

**What we hit.** With a `Session` attached, the guardrail's `input` is the **full prepared
transcript** (history + new turn). Our `blockme` test token from one turn then **tripped every
later turn** — a benign "say hello" got blocked because `blockme` was still in history.

**Edit — Decision 9 / guardrail material, add:**
> An input guardrail with a Session attached receives the **whole conversation so far**, not
> just the latest message. Screen **only the latest user turn** (extract the last `role: user`
> item), or a flagged word from any past turn will trip every future turn.

Include the tiny helper (we wrote `_latest_user_text(user_input)`): if `input` is a `str` use it;
if it's a list, walk it in reverse for the last `role == "user"` item and read its `content`.

### 1.5 The blocking terminal loop kills DB connections on Neon

**What we hit (live, mid-testing).** The interactive `input("you> ")` is a **blocking call that
freezes the asyncio event loop**, so asyncpg can't service its idle connections and Neon drops
them. The first audit write after the human types fails with
`ConnectionDoesNotExistError('connection was closed in the middle of operation')`.

**Two-part fix we applied:**
1. Run the prompt in a thread so the loop stays alive: `await asyncio.to_thread(input, "you> ")`
   (same for the approval prompt).
2. Make the pool resilient: `max_inactive_connection_lifetime=60` + retry once on
   `(asyncpg.PostgresConnectionError, asyncpg.InterfaceError, OSError, ConnectionError)` (the dead
   connection is discarded and re-acquire opens a fresh one). The MCP client already survives via
   `max_retry_attempts=3`; the hand-rolled audit pool did not until we added this.

**Edit.** Wherever the terminal loop is shown, note the `asyncio.to_thread` requirement, and add a
line to Concept 15 (pooling): *a long-lived Worker on a scale-to-zero/pooled Postgres must recycle
idle connections and retry once on a dropped connection.*

---

## 2. 🟡 Accuracy / consistency

### 2.1 `statement_cache_size=0` is mandatory on Neon's pooled endpoint
Both the `customer-data` MCP pool (Decision 6) and the audit pool (Decision 7) need
`asyncpg.create_pool(..., statement_cache_size=0)`. Neon's pooler (PgBouncer, transaction mode)
breaks asyncpg's prepared statements otherwise. The lesson flags the `search_path` reset on the
pooled endpoint but not this — and this one bites first.

### 2.2 `issue_refund(order_id, amount, reason)` → use `amount_cents` (int)
Concept 14 and the Decision 6 prompt use `amount`. Use integer **cents** to avoid float-money
rounding bugs (AGENTS.md already specifies `amount_cents`). Standardize across the lesson.

### 2.3 The `audit_log.conversation_id` FK needs the conversation row to exist first
`audit_log.conversation_id` references `conversations(session_id)`. When an audited action wrote a
row referencing a session id with **no** `conversations` row, the FK violated and **rolled back the
whole refund transaction**. State plainly: upsert the `conversations` row at `message_received`
(or write `NULL`). Decision 3 creates the table but never says *when the row is created*.

### 2.4 Decision 8 overstates `skill_activated`
On the exact `#4429` message, the Worker called the `find_similar_resolved_tickets` **MCP tool
directly without loading a skill** → trace was `message_received → capability_invoked →
message_sent`, **no `skill_activated`**. The model can reach the tool without the skill (and
`find-similar-cases` is only a scaffolded description anyway). Soften step 2 to "**a skill may
activate**," or learners will think a correct build is broken.

### 2.5 `capability_invocations.status` CHECK
As-built it was `('ok','error','blocked')`; Concept 7 prints `('ok','error','timeout')`. We hit a
rejected insert logging a skill load with a value outside the set. Make the printed DDL and the
values the code writes agree (and note that "blocked" is the natural value for an approval reject).

---

## 3. 🟢 Callouts worth adding (scars)

### 3.1 The approval gate only fires once the model *actually calls* the tool
In Decision 9 the model repeatedly **asked for approval conversationally** and never invoked
`issue_refund`, so the gate never engaged (and no refund happened). The lesson's own system-prompt
guidance ("issue_refund — only once approved") *encourages* this. To demo the gate you must push
the call: *"Call issue_refund now — invoke the tool."* Add a note: the SDK gate is the hard
backstop on **execution**; it cannot force the model to route through a tool, and a cautious system
prompt can make the model talk instead of act.

### 3.2 The `documents → tickets` join is through `metadata->>'ticket_id'`, not a column
`documents` has no `ticket_id` column; the link lives in JSONB metadata. If Decision 5's seed
doesn't put `ticket_id` in `documents.metadata`, Decision 8's search **silently returns nothing**.
The lesson hints ("the ticket id in its metadata") but should make the exact join shape explicit in
both Decision 5 and Decision 6, because a mismatch is invisible.

### 3.3 Tier lives in `customers.metadata->>'tier'`, not a column
`lookup_customer` reads `COALESCE(metadata->>'tier', 'standard')`. If the lesson's schema or seed
implies a `tier` column, the tool and the data disagree. State where tier lives.

---

## 4. 🚀 Proposed new challenge — "Decision 10: make the paused approval survive a restart"

The lesson already plants the seed (the Decision 9 note about `run_states` and `RunState`). Turn it
into a graded challenge, because it's the single biggest step from "works on my laptop" to "runs in
a distributed environment" — and it's exactly the **state-to-DB** idea the learner is chasing.

> **✅ Built & verified in this repo** (`run_store.py`, `decide.py`, `run_states` table,
> `issue_refund` idempotency, per-conversation lock). Two gotchas surfaced while building it that
> the lesson should pre-warn about:
> 1. **`RunState` serialize/reload is async.** Confirmed: `result.to_state().to_string()` to park,
>    `await RunState.from_string(agent, s)` to reload — `from_string` is an async classmethod taking
>    `(initial_agent, state_string)`. Resuming is a **loop** (`while result.interruptions:`), not one call.
> 2. **Session-level advisory locks do NOT survive Neon's pooled endpoint.** PgBouncer transaction
>    pooling recycles the backend after each statement, dropping the lock immediately (a second holder
>    falsely acquires it — this failed our first test). The lock must run on a **dedicated, non-pooled
>    connection** (Neon's direct endpoint = the pooled URL minus `-pooler`), which also gives
>    crash-safety for free (drop the connection → lock auto-released, no lease needed).
> 3. **Idempotency vector is the retry, not the human.** `(order_id, request_id)` unique + an
>    idempotency-check-first in the tool; the real double-run is an SDK MCP-client retry resending
>    identical args, so the request_id is stable across it.
> The one piece left even after this: a **delivery loop** (telling the user "approved" unprompted) —
> approving in another process updates the DB but does not speak back to the original chat.

### The framing (put this up top)

> You've already moved three kinds of state into Postgres: **turns** (the Session), **business
> records + reference library**, and the **audit trail**. One kind is still stuck in process
> memory: the **paused run** itself. Today, when `issue_refund` pauses for approval, the
> `RunState` lives in RAM and the human must answer *in the same process, right now*. In a
> distributed deployment the approver might answer 10 minutes later, on a different server. This
> challenge moves that last piece of state into the DB.

### Goal
Approve or reject a paused refund **from a different process than the one that started the run.**

### Build steps
1. **Add a `run_states` table** (the lesson already names it):
   ```sql
   CREATE TABLE run_states (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       session_id      TEXT NOT NULL REFERENCES conversations(session_id),
       tool_name       TEXT NOT NULL,        -- e.g. 'issue_refund'
       arguments       JSONB NOT NULL,       -- what the model wants to do
       state           TEXT NOT NULL,        -- the serialized RunState (state.to_string())
       status          TEXT NOT NULL DEFAULT 'awaiting'
                        CHECK (status IN ('awaiting','approved','rejected','resumed')),
       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       decided_at      TIMESTAMPTZ
   );
   ```
   It is **not** `audit_log` (append-only) and **not** a column on `conversations` (one
   conversation can pause more than once).

2. **On pause, persist instead of blocking.** When `result.interruptions` is non-empty, write a
   `run_states` row (`state = result.to_state().to_string()`, `status='awaiting'`) and **return to
   the caller** — do not call `input()`. One turn = one request that either finishes or parks.

3. **Approve/reject out of band.** A second entry point (a CLI subcommand, an HTTP route, or a poll
   loop) lists `awaiting` rows, takes a human decision, sets `status`, and **resumes from the stored
   state**: `state = await RunState.from_json(agent, json.loads(row.state))`, then `approve`/`reject`
   each interruption, then `Runner.run(agent, state)` — **in a loop** while interruptions remain
   (a run can hold more than one pending approval; resuming once can return empty with the refund
   unwritten).

4. **Make `issue_refund` idempotent.** In a retry-happy distributed world a network retry can
   double-issue. Add an idempotency key (e.g. dedupe on `order_id` + a request id) so the same
   refund can't run twice. Prove it: fire the approved resume twice; assert exactly one `refunds` row.

5. **Serialize per session.** Two turns on the same `session_id` at once will race the Session.
   Add a per-session lock (a Postgres advisory lock or a `status` guard) so only one turn is active
   per conversation.

### Acceptance criteria ("done when")
- Start a refund in **process A**; A exits with the run **parked** in `run_states` (`awaiting`),
  and **no** `refunds` row exists yet.
- In **process B**, approve it; the refund commits (refund row + order flip + `refund_issued`),
  `run_states.status='resumed'`.
- Reject path in B leaves **zero** business writes and a `refund_blocked` audit row.
- Re-running the approved resume a second time issues **no** second refund (idempotency holds).
- The whole thing is replayable from `audit_log` + `run_states` without re-running the model.

### Stretch (full distributed)
- Deploy the `customer-data` server behind a real URL with **auth headers** (the
  `MCPServerStreamableHttp` params already support `headers`), and point the Worker at
  `CUSTOMER_DATA_MCP_URL`.
- Swap `UnixLocalSandboxClient` for a hosted sandbox client (E2B / Modal / Cloudflare) — "swap the
  client, keep the agent."
- Move secrets from `.env` to a secret manager.

> **The one-line lesson:** *state in the DB is necessary but not sufficient — the last stateful
> thing to move is the paused run itself, and once it's in `run_states` your Worker stops being
> tied to one process.*

---

## 5. Making it followable for beginners

The course is labeled "intermediate," and fairly. But small additions let a motivated beginner
survive it:

1. **A glossary box up front** for five words used as if known: *transaction* (all-or-nothing),
   *pool* (a set of reusable DB connections), *migration* (a tracked schema change), *interruption*
   (the SDK pausing a run), *idempotent* (running twice = running once). One line each.
2. **A "you are here" recap before each Decision** — one sentence: what exists now, what this
   Decision adds, what you'll see at the end. (The Part 4 overview diagram does this globally; do it
   locally too.)
3. **"What good looks like" sample output** under each **Check**, not just the instruction. Show the
   actual trace rows / the actual reply, so a beginner can pattern-match instead of guessing whether
   their result is right. (Several Checks say "show me X" but never show what X *should* look like.)
4. **A failure-first framing on the two scariest Decisions (7 and 9).** Lead with "here's the error
   you will probably see, and what it means" — the `slice(...)` crash, the
   `ConnectionDoesNotExistError`, the CHECK-constraint rejection, the conversational-bypass of the
   gate. A beginner who sees the error *named in advance* keeps going; one who hits it cold quits.
5. **Two terminals, stated explicitly** for the live Decision 6/8/9 runs (server in one, Worker in
   the other), with the start-order ("server first") called out. We had to discover this.
6. **Label every prompt's expected *artifact*** (which file gets created/edited), so a beginner can
   confirm the agent did the right thing structurally even before running it.

---

## 6. Is this a "sample solution"? — yes, with a label and a scrub

**Verdict: yes — this build is a legitimate reference/sample solution for Part 4 + Decision 9**,
and worth saving, *if* you label it honestly and sanitize it first. It exercises every concept and
every behavior was observed working (Section 0). What makes it a *sample* and not *production*:

- It runs as a single terminal process; approval is a `[y/N]` prompt (Decision 10 above is the gap).
- Data is seeded/test data in one Neon project; the orders refunded were created to test.
- Only `summarize-ticket` of the three skills is scaffolded; `find-similar-cases` /
  `escalate-with-context` are descriptions, not built skills.
- The MCP server is started by hand on `127.0.0.1:8000`.

### Before saving/sharing it anywhere — scrub checklist
- [ ] **Secrets:** delete/rotate `OPENAI_API_KEY`, `DATABASE_URL`, `NEON_DATABASE_URL`. Ship only
      `.env.example`. Confirm `.env` is gitignored.
- [ ] **Connection strings** embedded in any committed file (none should remain).
- [ ] **The two throwaway scripts** (`customer-data-mcp/verify.py`, `verify_refund.py`) — keep as
      "how to verify" examples or remove; they reference live data and a hardcoded `customer_id`.
- [ ] **Hardcoded test ids** (`cust_05204f7c`, `order_demo_*`, refund UUIDs) — replace with
      placeholders or seed-generated values.
- [ ] **The mis-provisioned `digital-fte` Neon project** — note in the README it's unused/wrong;
      the real DB is the `chat-agent` project. (Better: delete it so a reader isn't confused.)
- [ ] **A `SOLUTION.md`** stating: which Decisions it covers (1–9), what's intentionally left as an
      exercise (Decision 10 / distributed), and the verification matrix from Section 0.
- [ ] **Pin versions** actually used (`openai-agents 0.17.x`, `mcp`, `pgvector`, `asyncpg`) so it
      reproduces.

### How to label it
> **Reference solution — Digital FTE Part 4 + Decision 9 (laptop tier).** Verified end-to-end May
> 2026. Single-process; synchronous approval. The distributed/persisted-approval step is left as
> Decision 10 (see `lesson-feedback.md`). Not production-hardened: no auth on the MCP server, test
> data only.

That labeling is the honest version of the lesson's own "invariant vs owned" caveat: it's a real,
working artifact you can learn from and extend — and it's explicitly *the laptop tier*, not the
deployed workforce.

---

## Appendix: file inventory of the as-built solution

| File | Role |
| --- | --- |
| `chat.py` | the Worker: `SandboxAgent` (gpt-5) + `SQLAlchemySession` + `mcp_servers` + Skills + input guardrail + `run_turn` (bookends, approval loop, guardrail catch, `asyncio.to_thread` input) |
| `audit.py` | `AuditLogger` (own asyncpg pool, `statement_cache_size=0`, `max_inactive_connection_lifetime=60`, retry `_execute`) + `AuditRunHooks` |
| `customer-data-mcp/server.py` | FastMCP streamable-HTTP stateless server; lifespan pool + `register_vector`; 3 tools, no `run_sql`; `issue_refund` atomic |
| `customer-data-mcp/README.md` | how to run + wire it |
| `customer-data-mcp/verify.py`, `verify_refund.py` | throwaway end-to-end checks (scrub before sharing) |
| `plans/customer-support-worker-plan.md` | the Decision-2 plan |
| `.claude/skills/summarize-ticket/` | the one scaffolded domain skill |

**Two-actor audit pattern (the thing worth copying):** the `customer_data_mcp` actor writes the
in-transaction `refund_issued` row *inside* the tool; the `chat-agent` actor writes the
observational trace (`message_received`, `capability_invoked`, `message_sent`, `guardrail_tripped`,
`refund_blocked`) from the Worker via its own pool. They share `audit_log` but never share a
connection — which is exactly why the audit can't be starved by the boundary it audits.

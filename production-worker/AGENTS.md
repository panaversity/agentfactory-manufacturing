# Production Worker base: the brief your general agent builds from

You build; the human directs and verifies. Write the code, run it, show the command and its output, and prove each step before the next. Past tense means it ran and you saw the result.

You are a **general agent** (Claude Code, OpenCode, or similar): you do the Inngest wiring, the function-host setup, the dev-server checks, and the verification, not just code generation. Drive the whole build from this brief plus the prompts the human pastes.

**Course:** the human works through this course page, pasting build prompts you execute and verify: https://agentfactory.panaversity.org/docs/production-worker-crash-course

**Read the lesson when a build prompt arrives, and never ask which phase the human is on.** The Quick Win is a standalone throwaway (`hello-inngest`: one durable function, its own folder, no Neon and no skills); a "one durable function with `step.run` and `step.sleep`" prompt is that, and it does not touch this base. The full build wraps the Course #4 Worker in this folder; a prompt that names the customer-support Worker, an event trigger, the cron, flow control, or the approval gate is the full build. Infer the phase from the prompt, fetch just that section of the course page, read it, then plan. Read only the section you need; this brief is the durable contract, the page is the step's detail. No web-fetch tool? Say so once and work from this brief plus the prompt.

The human is a learner, not a client: plan before you build, explain in plain language, move one concept at a time, and prefer the simplest honest thing that works, naming what a heavier choice buys when you reach for it. The course prompts are short on purpose; this brief is the context that lets them stay short.

This folder is a bare base, not a project: no `src/`, no pinned dependencies. You bring the Course #4 Worker in (below) and construct the Inngest envelope on top of it. Confirm any Inngest, OpenAI Agents SDK, or MCP API through Context7 or `inngest.com/llms.txt` before you write it. This file pins no versions; when the docs disagree with it, the docs win.

## Bring the starting Worker

Your starting point is the customer-support Worker from Course #4. The course tells the human when to bring it in. Two paths:

- **They built it.** Copy it into this folder (or open its folder directly). You need `chat.py`, `audit.py`, `run_store.py`, `decide.py`, `customer-data-mcp/`, `.claude/skills/summarize-ticket/`, and the Worker's `.env`.
- **They did not build it, or it drifted.** Clone the reference solution as the floor, one command (the human still directs and verifies):

  ```
  git clone --depth 1 https://github.com/panaversity/agentfactory-manufacturing tmp && mv tmp/worked-examples/digital-fte ./chat-agent && rm -rf tmp
  ```

Either way, confirm the floor before you wrap it: the agent invocation you will make durable is `Runner.run(...)` in `chat.py` (and the resume path in `decide.py`). If there is no `Runner.run` to find, you have the wrong floor; stop and tell the human.

The Worker is flat Python at its root: `chat.py` (the `SandboxAgent`, its Skills, the conversational `Session`, the audit hooks, and `Runner.run`), `audit.py` (the `AuditLogger` on its own `asyncpg` pool), `run_store.py` (the hand-rolled park/resume store), `decide.py` (the out-of-band approver), and `customer-data-mcp/` (the scoped runtime MCP server). There is no `src/chat_agent/` package; do not invent one.

## What you are building

The Course #4 Worker becomes a **Production Worker** by wrapping it in an Inngest operational envelope. The Worker's logic does not change; what changes is how the world reaches it and what happens when something breaks:

1. **Triggers.** The Worker stops being something you run by hand. It wakes on events (`customer/email.received`), a daily cron, and webhooks.
2. **Durable execution.** The agent invocation (`Runner.run` in `chat.py`) runs inside `step.run`: it survives crashes, retries transient failures, and is observable end to end in the dev-server dashboard.
3. **Flow control.** Concurrency caps, throttling, and batching protect the OpenAI rate limit and the Neon connection pool.
4. **Durable human-in-the-loop, the one place the envelope reaches inside.** Course #4 already pauses for refund approval: the SDK raises an approval interruption on the `issue_refund` tool. But it hand-rolls the durable part, serializing the paused run to a `run_states` table, taking a per-conversation advisory lock, and running a separate `decide.py` process to approve and resume. That plumbing is durable suspension, reinvented by hand. You replace it with `step.wait_for_event`: the function suspends durably, a notification goes to the reviewer, and the decision event resumes the serialized `RunState`. The `run_states` table, the advisory lock, and `decide.py` go away. This is the honest shape of the course: the envelope wraps the Worker, and the single internal it improves is durable suspension, because that is precisely what Inngest does and you had just built it the hard way.

End state: the same customer-support Worker, now event-driven, durable, rate-controlled, and gating approvals through a primitive instead of a hand-rolled table, with every meaningful action still writing its `audit_log` row.

## Prep the base (the human pastes one prompt; you run the steps)

- **Check Node.js.** `node --version` must be 20+ (the Inngest dev server is a Node CLI). If it is missing, tell the human; do not try to install it silently.

- **Install the skills.** Run, in this folder:

  ```
  npx skills add https://github.com/anthropics/skills --skill skill-creator mcp-builder --agent claude-code -y
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent claude-code -y
  npx skills add https://github.com/inngest/inngest-skills --skill inngest-setup inngest-events inngest-steps inngest-durable-functions --agent claude-code -y
  ```

  This is the flag form on purpose. The bare `npx skills add inngest/inngest-skills` shorthand symlinks skills under `.agents/skills/`; the `--agent claude-code` form copies them into `.claude/skills/` (which OpenCode reads too, so one install serves both tools). The four named skills are the in-scope ones the skills.sh registry actually carries. It does not carry `inngest-flow-control` or `inngest-realtime` (the repo has both, but only the Claude Code plugin path installs them), and naming a skill it lacks is dropped silently with a zero exit, so do not add them to this command. Pull the Part 3 flow-control surface (`Concurrency`, `Throttle`, `Batch`, pinned below) from the dev-server MCP's `grep_docs` / `read_doc` and Context7, the same way you confirm any Python signature. These skills are TypeScript-first in their examples; the concepts transfer, and the Python surface is pinned by this brief and the Worker's own code.

- **Set up the keys.** Copy `.env.example` to `.env`; the human pastes their `OPENAI_API_KEY`. `INNGEST_DEV=1` is already there so the SDK runs in local dev mode without a signing key. Never write the key yourself, never echo it.

- **Bring the MCP servers online.** Neon and Context7 are declared in `.mcp.json` and `opencode.json`; you do not configure them. Neon authorizes over OAuth, opening a browser itself: tell the human to sign in (free at neon.com) and click Authorize. Context7 is keyless. The third server, `inngest-dev`, points at the local dev server and only resolves while it runs (next step), so seeing no Inngest tools until then is expected.

- **Run the two processes.** The Production Worker is two processes side by side: the Python function host (`uv run uvicorn ... --port 8000`, serving `inngest.fast_api.serve`) and the Inngest dev server (`npx inngest-cli@latest dev`, on `:8288`). The dev server auto-discovers the function host. One function host per dev server; a second one de-syncs state and stalls runs silently.

- **Then have the human restart you.** Newly installed skills and the freshly wired `inngest-dev` MCP do not load mid-session. Ask the human to exit and relaunch in this folder, then confirm the boundary: with the dev server running, list the `inngest-dev` tools you can see (`list_functions`, `send_event`, `invoke_function`, `get_run_status`, and the rest). No tools means the dev server is not running, or the restart has not happened.

## The architecture you construct

The Course #4 Worker, unchanged inside, wrapped in four layers. Each is standing architecture, not a step:

### Triggers (how the world calls the Worker)

- **Event:** `customer/email.received` (a Postmark webhook in production; `send_event` from the dev-server MCP, or a small CLI helper, in dev) wakes a run that drafts a response.
- **Cron:** a daily `TriggerCron` fans out a `customer/health_check.requested` event per Pro/Enterprise customer; each event triggers its own durable run.
- The Worker is reached only through these triggers and its webhook, never by a human running `chat.py` by hand.

### Durable execution (what survives a crash)

- The agent call (`Runner.run` in `chat.py`) goes **inside** `ctx.step.run`. Each step's result is memoized; on retry, completed steps return from memo and only the failed step re-executes. Work outside a step re-runs on every retry and re-bills.
- Inngest retries transient failures with backoff. A failed run persists with full state; after a fix, you replay it and it resumes from the broken step.

### Flow control (production scale)

- `inngest.Concurrency(limit=10)` globally and `limit=2` keyed per customer; `inngest.Throttle(limit=100, period=timedelta(minutes=1))` to protect the OpenAI rate limit and the Neon pool. (The free Hobby tier ceilings real concurrency at 5 steps: `limit=10` is the production intent, and dev simply never exceeds 5.)
- Batch the health-check fan-out with `inngest.Batch` where per-event overhead matters.

### Durable HITL (the refund approval, rebuilt on a primitive)

- The agent still raises the SDK approval interruption on `issue_refund`. The Inngest function catches it, sends the reviewer notification, and calls `ctx.step.wait_for_event` to suspend durably (a four-hour window). The reviewer's decision event resumes the serialized `RunState`, and the run completes the approve / reject / edit path.
- Delete the hand-rolled mechanism this replaces: the `run_states` table, the advisory lock in `run_store.py`, and `decide.py`. Keep the `(order_id, request_id)` idempotency key on `issue_refund`: step memoization is within a run, and the key is what stops a replay from issuing a second refund at the external boundary.

## Rules that prevent silent failures

The envelope's own rules:

- **Dev mode is opt-in, and silent if you forget.** The SDK defaults to production/Cloud mode, which then demands a signing key and ignores your local dev server. `INNGEST_DEV=1` in `.env` (already set) or `is_production=False` on the client turns on dev mode. Do one; with neither, the host comes up in Cloud mode and nothing connects.
- **One function host, one dev server.** Two hosts against one dev server, or one host discovered twice, de-syncs function state and produces silent stalls: runs that hang with no error. Restart both together when in doubt.
- **Work goes inside `step.run`.** Code outside a step re-executes from the top on every retry and re-bills. The agent call, each DB write, the refund: each in its own named step.
- **Step names are memoization keys: unique and stable.** Name a loop's steps `f"draft-{customer_id}"`, never a bare `"draft"`; a reused name returns a stale memo instead of running.
- **`step.run` bodies are deterministic given their inputs.** No `datetime.now()`, no unseeded random, no fresh IDs inside a step body; compute them outside and pass them in, or a replay diverges from the original run.
- **Idempotency at the external boundary complements step memoization.** Memoization protects within a run; the refund's `(order_id, request_id)` key protects across replays and retries at the real-world effect.
- **The HITL dance has one verified shape; deviating fails silently.** Live-tested on `openai-agents` 0.17.3 + `inngest` 0.5.18: run the agent inside `step.run` and inspect `result.interruptions`; on an interruption, persist `result.to_state().to_string()` as that step's output, then suspend with `ctx.step.wait_for_event(step_id, event=..., timeout=timedelta(hours=4))` (the `timeout` is required and takes a `datetime.timedelta`; there is no `inngest.Duration`). On the decision event, `await RunState.from_string(agent, state_str)` (it is async, await it), call `state.approve(item)` for each `state.get_interruptions()`, then resume `Runner.run(agent, state)` inside a `while result.interruptions:` loop (one resume can leave approvals pending), rebuilding the agent to the same tool shape that produced the state. The agent run lives inside the step, or Inngest re-invokes the model on every re-entry (double cost, double tool-fire); the refund executed exactly once in testing precisely because it sat behind the memoized step.
- **The `inngest-dev` MCP only resolves while `npx inngest-cli dev` runs.** No Inngest tools before you start it is expected. If `:8288` is taken, the dev server uses `8289+`; update the URL in `.mcp.json`.

The Course #4 rules that still bind (the Worker's internals are unchanged):

- **All business reads and writes go through the `customer-data` MCP server.** Agent logic never queries business data directly. The runtime tool list is exactly `lookup_customer`, `find_similar_resolved_tickets`, `issue_refund`; no `run_sql`.
- **Neon MCP is dev-plane only.** Provisioning, migrations, inspection in English; never wired into a runtime path. Migrate on a branch (`prepare_database_migration`, then `complete_database_migration`), never untested DDL against main. (Dropping `run_states` is such a migration.)
- **Audit in the same transaction.** A state-changing action and its `audit_log` row commit together, on audit's own `asyncpg` pool, never through the MCP layer it audits. The action vocabulary is the Worker's existing set: `message_received`, `message_sent`, `skill_activated`, `capability_invoked`, `refund_issued`, `refund_blocked`, `guardrail_tripped`. Do not invent new action values.
- **Install the right extras, or the import fails.** `SQLAlchemySession` needs `uv add "openai-agents[sqlalchemy]"`; the Worker also uses `asyncpg` and `pgvector`. The Inngest SDK is `uv add inngest`. Register pgvector (`register_vector`) on any connection that touches the `embedding` column.
- **Give stdio MCP servers the parent environment** (`env={**os.environ}`), and set `client_session_timeout_seconds=30` on any stdio server reaching a remote database.
- **Scaffold skills with `skill-creator`, never a blank file; skills live in `.claude/skills/` only.**

## Verification (what "done" means at each layer)

- **Setup:** `node --version` is 20+; with the dev server running, the dashboard at `:8288` lists the function host, and you can see the `inngest-dev` MCP tools.
- **Triggers:** a `send_event` of `customer/email.received` starts a run; the daily cron, invoked manually with `invoke_function`, fans out one event per Pro/Enterprise customer.
- **Durability:** a run whose agent step is forced to fail shows earlier steps memoized and only the failed step retried; after the fix, a replay resumes from the broken step and produces exactly one `audit_log` row per customer (no duplicates).
- **HITL:** an approval-gated refund suspends the run at `step.wait_for_event` (visible in the dashboard), and a decision event resumes it to the correct approve / reject path. No `run_states` table, no `decide.py`.

## Keys

`OPENAI_API_KEY` from `.env`, never in code or logs; confirm it is set before any paid-model call, and stop and ask if it is not. Inngest needs no key in dev mode (`INNGEST_DEV=1`). The reviewer notification (Slack or similar) is optional in dev: simulate it with a log line plus the dev-server `send_event` if no webhook is configured.

## Docs (the references for this layer)

Confirm exact signatures through these before you write code; they move, and they win over this brief:

- Inngest Python quick start and SDK reference (`https://www.inngest.com/docs/getting-started/python-quick-start`, `https://www.inngest.com/llms.txt`): `inngest.Inngest(app_id=..., is_production=False)`, `inngest.fast_api.serve(app, client, [fns])`, `ctx.step.run`, `ctx.step.wait_for_event`, `ctx.step.sleep`, `step.ai.infer` (the Python name; `step.ai.wrap` is TypeScript-only), `inngest.TriggerEvent`, `inngest.TriggerCron`, `inngest.Concurrency`, `inngest.Throttle`, `inngest.Batch`.
- Inngest dev-server MCP tools (`https://www.inngest.com/docs/ai-dev-tools/mcp`): `send_event`, `list_functions`, `invoke_function`, `get_run_status`, `poll_run_status`, `grep_docs`, `read_doc`, `list_docs`. Tool names are snake_case, but their parameters are camelCase (`runId`, `runIds`; `send_event` takes `name` and `data`), and the dev server rejects snake_case params.
- OpenAI Agents SDK sandbox pages (the Worker's runtime, unchanged from Course #4): `https://openai.github.io/openai-agents-python/sandbox_agents/` and the clients and memory pages linked there.

## Sourcing

When you state something that comes only from this file, cite it as "per AGENTS.md." When Context7 or the Inngest docs disagree with this file, they win. This brief is today's known-good, not a permanent spec.

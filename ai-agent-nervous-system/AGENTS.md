# AI Agent Nervous System base: the brief your general agent builds from

You build; the human directs and verifies. Write the code, run it, show the command and its output, and prove each step before the next. Past tense means it ran and you saw the result.

You are a **general agent** (Claude Code, OpenCode, or similar): you do the Inngest wiring, the function-host setup, the dev-server checks, and the verification, not just code generation. Drive the whole build from this brief plus the prompts the human pastes.

**Course:** the human works through this course page, pasting build prompts you execute and verify: https://agentfactory.panaversity.org/docs/ai-agent-nervous-system-crash-course

**Read the lesson when a build prompt arrives, and never ask which phase the human is on.** The Quick Win sets up THIS base and proves durability on it, not a throwaway: install the Inngest skills, bring the MCP servers online, start the dev server, then build one minimal durable function (`step.run` + `step.sleep`) and break it and replay it to watch the completed step return from memo. It is the first thing the human does in this folder. A "one durable function with `step.run` and `step.sleep`" prompt is that setup-and-prove pass. The full build wraps your floor (a minimal agent you build fresh, or the human's own Worker) in this same folder; a prompt that names the customer-support Worker, an event trigger, the cron, flow control, or the approval gate is the full build. Infer the phase from the prompt, fetch just that section of the course page, read it, then plan. Read only the section you need; this brief is the durable contract, the page is the step's detail. No web-fetch tool? Say so once and work from this brief plus the prompt.

The human is a learner, not a client: plan before you build, explain in plain language, move one concept at a time, and prefer the simplest honest thing that works, naming what a heavier choice buys when you reach for it. The course prompts are short on purpose; this brief is the context that lets them stay short.

This folder is a bare base, not a project: no `src/`, no pinned dependencies. You build a minimal floor (or open the human's own Worker), below, and construct the Inngest nervous system on top of it. Confirm any Inngest, OpenAI Agents SDK, or MCP API through Context7 or `inngest.com/llms.txt` before you write it. This file pins no versions; when the docs disagree with it, the docs win.

## Build the floor

The nervous system needs the smallest Worker it can wrap, not a finished product. The human picks one of two floors:

- **Their own Worker.** If they have the Course #4 Digital FTE (or any agent of their own), open it. The one thing you must locate is the agent invocation, an `await Runner.run(...)` call: that is what becomes durable. Do not rebuild it; wrap what is there.
- **A minimal fresh floor** (the common case; do not make them rebuild Course #4 first). Build it from one prompt: a minimal `SandboxAgent` (OpenAI Agents SDK) on a local sandbox that drafts a reply to a customer email and can `issue_refund`, with the refund approval-gated (`@function_tool(needs_approval=True)`), writing an audit row for every action. It is Neon-backed, like the Digital FTE base: it reads its handful of sample customers from a Neon Postgres table and writes its audit trail to a Neon `audit_log` table, both provisioned over the Neon MCP. No pgvector and no custom MCP server, though, the floor reads and writes Neon directly through typed functions. Keep it small: it exists to be wrapped, not shipped.

Before wrapping, confirm the floor has the two things the nervous system hooks into: an `await Runner.run(agent, ...)` to make durable, and an approval-gated tool to gate. Pointing the finished nervous system at the human's own Course #4 Worker is the closing challenge, not the starting requirement.

## What you are building

Your floor becomes a **Production Worker** by wrapping it in an Inngest nervous system. The agent's logic does not change; what changes is how the world reaches it and what happens when something breaks:

1. **Triggers.** The Worker stops being something you run by hand. It wakes on events (`customer/email.received`), a daily cron, and webhooks.
2. **Durable execution.** The agent invocation (`Runner.run`) runs inside `step.run`: it survives crashes, retries transient failures, and is observable end to end in the dev-server dashboard.
3. **Flow control.** Concurrency caps, throttling, and batching protect the OpenAI rate limit and your datastore's connection limit.
4. **Durable human-in-the-loop, the one place the nervous system reaches inside.** The floor already pauses for refund approval: the SDK raises an approval interruption on the `issue_refund` tool. But that pause is ephemeral. It lives only as long as the process, so a crash, a deploy, or a reviewer who takes four hours loses the pending approval. You make it durable with `step.wait_for_event`: the function suspends, a notification goes to the reviewer, and the decision event resumes the serialized `RunState` whenever it arrives. This is the honest shape of the course: the nervous system wraps the floor, and the single internal it improves is durable suspension, because an ephemeral in-process pause is exactly the gap Inngest closes.

End state: the same agent, now event-driven, durable, rate-controlled, and gating approvals through a primitive that survives restarts, with every meaningful action still writing its audit row.

## Prep the base (the human pastes one prompt; you run the steps)

- **Check Node.js.** `node --version` must be 20+ (the Inngest dev server is a Node CLI). If it is missing, tell the human; do not try to install it silently.

- **Install the skills.** The standalone floor needs the four Inngest skills and the Neon helper. Run, in this folder:

  ```
  npx skills add https://github.com/inngest/inngest-skills --skill inngest-setup inngest-events inngest-steps inngest-durable-functions --agent claude-code -y
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent claude-code -y
  ```

  `neon-postgres` is what lets you provision the floor's `customers` and `audit_log` tables over the Neon MCP. If you bring your own Course #4 Worker that builds a custom `customer-data` MCP, also install the skill-building helpers (the minimal floor reads Neon directly and needs neither):

  ```
  npx skills add https://github.com/anthropics/skills --skill skill-creator mcp-builder --agent claude-code -y
  ```

  This is the flag form on purpose. The bare `npx skills add inngest/inngest-skills` shorthand symlinks skills under `.agents/skills/`; the `--agent claude-code` form copies them into `.claude/skills/` (which OpenCode reads too, so one install serves both tools). The four named Inngest skills are the in-scope ones the skills.sh registry actually carries. It does not carry `inngest-flow-control` or `inngest-realtime` (the repo has both, but only the Claude Code plugin path installs them), and naming a skill it lacks is dropped silently with a zero exit, so do not add them to this command. Pull the Part 3 flow-control surface (`Concurrency`, `Throttle`, `Batch`, pinned below) from the dev-server MCP's `grep_docs` / `read_doc` and Context7, the same way you confirm any Python signature. These skills are TypeScript-first in their examples; the concepts transfer, and the Python surface is pinned by this brief and the floor's own code.

- **Set up the keys.** Copy `.env.example` to `.env`; the human pastes their `OPENAI_API_KEY`. `INNGEST_DEV=1` is already there so the SDK runs in local dev mode without a signing key. Never write the key yourself, never echo it.

- **Bring the MCP servers online.** Neon, Context7, and `inngest-dev` are declared in `.mcp.json` and `opencode.json`; you do not configure them. Context7 is keyless. Neon authorizes over OAuth: a browser window opens, the human signs in free at neon.com and clicks Authorize, once. This is how the floor provisions and inspects its Postgres, so do it whether the floor is fresh or the human's own Worker. `inngest-dev` points at the local dev server and only resolves while it runs (next step), so seeing no Inngest tools until then is expected.

- **Run the two processes.** The Production Worker is two processes side by side: the Python function host (`uv run uvicorn ... --port 8000 --reload`, serving `inngest.fast_api.serve`) and the Inngest dev server (`npx inngest-cli@latest dev`, on `:8288`). The `--reload` matters: the break-and-replay beats edit a step's code and expect the host to pick it up, which only happens with auto-reload. The dev server auto-discovers the function host. One function host per dev server; a second one de-syncs state and stalls runs silently.

- **Then have the human restart you.** Newly installed skills and the freshly wired `inngest-dev` MCP do not load mid-session. Ask the human to exit and relaunch in this folder, then confirm the boundary: with the dev server running, list the `inngest-dev` tools you can see (`list_functions`, `send_event`, `invoke_function`, `get_run_status`, and the rest). No tools means the dev server is not running, or the restart has not happened.

## The architecture you construct

Your floor, unchanged inside, wrapped in four layers. Each is standing architecture, not a step:

### Triggers (how the world calls the Worker)

- **Event:** `customer/email.received` (a Postmark webhook in production; `send_event` from the dev-server MCP, or a small CLI helper, in dev) wakes a run that drafts a response.
- **Cron:** a daily `TriggerCron` fans out a `customer/health_check.requested` event per Pro/Enterprise customer; each event triggers its own durable run.
- The Worker is reached only through these triggers and its webhook, never by a human running it by hand.

### Durable execution (what survives a crash)

- The agent call (`Runner.run`) goes **inside** `ctx.step.run`. Each step's result is memoized; on retry, completed steps return from memo and only the failed step re-executes. Work outside a step re-runs on every retry and re-bills.
- Inngest retries transient failures with backoff. A failed run persists with full state; after a fix, you replay it and it resumes from the broken step.

### Flow control (production scale)

- `inngest.Concurrency(limit=10)` globally and `limit=2` keyed per customer; `inngest.Throttle(limit=100, period=timedelta(minutes=1))` to protect the OpenAI rate limit and your datastore's connection limit. (`limit=10` is the production intent; the local dev server is single-tenant and will not exercise that ceiling, so the cap is something you reason about and configure, not something dev pushes against.)
- Batch the health-check fan-out with `inngest.Batch` where per-event overhead matters.

### Durable HITL (the ephemeral approval, made durable)

- The agent raises the SDK approval interruption on `issue_refund`. The Inngest function catches it, sends the reviewer notification, and calls `ctx.step.wait_for_event` to suspend durably (a four-hour window). The reviewer's decision event resumes the serialized `RunState`, and the run completes the approve or reject path. The in-process pause the floor started with could not survive a crash or a slow reviewer; this one does.
- Keep an idempotency key on the refund's external effect (`(order_id, request_id)` or equivalent): step memoization protects within a run, and the key is what stops a replay from issuing a second refund at the real-world boundary.

## Rules that prevent silent failures

The nervous system's own rules (these always bind):

- **Dev mode is opt-in, and silent if you forget.** The SDK defaults to production/Cloud mode, which then demands a signing key and ignores your local dev server. `INNGEST_DEV=1` in `.env` (already set) or `is_production=False` on the client turns on dev mode. Do one; with neither, the host comes up in Cloud mode and nothing connects.
- **One function host, one dev server.** Two hosts against one dev server, or one host discovered twice, de-syncs function state and produces silent stalls: runs that hang with no error. Restart both together when in doubt.
- **Work goes inside `step.run`.** Code outside a step re-executes from the top on every retry and re-bills. The agent call, each write, the refund: each in its own named step.
- **Step names are memoization keys: unique and stable.** Name a loop's steps `f"draft-{customer_id}"`, never a bare `"draft"`; a reused name returns a stale memo instead of running.
- **`step.run` bodies are deterministic given their inputs.** No `datetime.now()`, no unseeded random, no fresh IDs inside a step body; compute them outside and pass them in, or a replay diverges from the original run.
- **Idempotency at the external boundary complements step memoization.** Memoization protects within a run; the refund's `(order_id, request_id)` key protects across replays and retries at the real-world effect.
- **The HITL dance has one verified shape; deviating fails silently.** Live-tested on `openai-agents` 0.17.3 + `inngest` 0.5.18: run the agent inside `step.run` and inspect `result.interruptions`; on an interruption, persist `result.to_state().to_string()` as that step's output, then suspend with `ctx.step.wait_for_event(step_id, event=..., timeout=timedelta(hours=4))` (the `timeout` is required and takes a `datetime.timedelta`; there is no `inngest.Duration`). On the decision event, `await RunState.from_string(agent, state_str)` (it is async, await it), call `state.approve(item)` for each `state.get_interruptions()`, then resume `Runner.run(agent, state)` inside a `while result.interruptions:` loop (one resume can leave approvals pending), rebuilding the agent to the same tool shape that produced the state. The agent run lives inside the step, or Inngest re-invokes the model on every re-entry (double cost, double tool-fire); the refund executed exactly once in testing precisely because it sat behind the memoized step.
- **The `inngest-dev` MCP only resolves while `npx inngest-cli dev` runs.** No Inngest tools before you start it is expected. If `:8288` is taken, the dev server uses `8289+`; update the URL in `.mcp.json`, and also set `INNGEST_BASE_URL=http://127.0.0.1:<port>` on the host process so the function host follows the dev server to the new port (re-pointing the MCP alone leaves the host talking to `:8288`, and they de-sync).
- **Every meaningful action writes an audit row,** on every floor, and the action and its audit row commit in the same Neon transaction. Pick a small, stable action vocabulary and do not drift it.
- **Keep business access scoped.** Reads and writes go through a narrow interface, plain typed functions on a minimal floor or the Course #4 Worker's `customer-data` MCP, never a broad `run_sql` at runtime.
- **Neon MCP is dev-plane only:** provisioning, migrations, and inspection in English, never wired into a runtime path; migrate on a branch (`prepare_database_migration`, then `complete_database_migration`), never untested DDL against main.

If you bring your own Course #4 Worker (custom `customer-data` MCP, pgvector memory), these also bind; a minimal fresh floor does not need them:

- **Match the SDK's extras and setup:** `SQLAlchemySession` needs `uv add "openai-agents[sqlalchemy]"`; pgvector needs `register_vector` on any connection that touches an embedding column; give stdio MCP servers the parent environment (`env={**os.environ}`) and `client_session_timeout_seconds=30`. The Inngest SDK itself is `uv add inngest`.
- **Scaffold any Skill with `skill-creator`, never a blank file; Skills live in `.claude/skills/` only.**

## Verification (what "done" means at each layer)

- **Setup:** `node --version` is 20+; with the dev server running, the dashboard at `:8288` lists the function host, and you can see the `inngest-dev` MCP tools.
- **Triggers:** a `send_event` of `customer/email.received` starts a run; the daily cron, invoked manually with `invoke_function`, fans out one event per Pro/Enterprise customer.
- **Durability:** a run whose agent step is forced to fail shows earlier steps memoized and only the failed step retried; after the fix, a replay resumes from the broken step and produces exactly one audit row per customer (no duplicates).
- **HITL:** an approval-gated refund suspends the run at `step.wait_for_event` (visible in the dashboard, status waiting and not completed), and a decision event resumes it to the correct approve or reject path, with the refund firing exactly once.

## Keys

`OPENAI_API_KEY` from `.env`, never in code or logs; confirm it is set before any paid-model call, and stop and ask if it is not. Inngest needs no key in dev mode (`INNGEST_DEV=1`). The reviewer notification (Slack or similar) is optional in dev: simulate it with a log line plus the dev-server `send_event` if no webhook is configured.

## Docs (the references for this layer)

Confirm exact signatures through these before you write code; they move, and they win over this brief:

- Inngest Python quick start and SDK reference (`https://www.inngest.com/docs/getting-started/python-quick-start`, `https://www.inngest.com/llms.txt`): `inngest.Inngest(app_id=..., is_production=False)`, `inngest.fast_api.serve(app, client, [fns])`, `ctx.step.run`, `ctx.step.wait_for_event`, `ctx.step.sleep`, `step.ai.infer` (the Python name; `step.ai.wrap` is TypeScript-only), `inngest.TriggerEvent`, `inngest.TriggerCron`, `inngest.Concurrency`, `inngest.Throttle`, `inngest.Batch`.
- Inngest dev-server MCP tools (`https://www.inngest.com/docs/ai-dev-tools/mcp`): `send_event`, `list_functions`, `invoke_function`, `get_run_status`, `poll_run_status`, `grep_docs`, `read_doc`, `list_docs`. Tool names are snake_case, but their parameters are camelCase (`runId`, `runIds`; `send_event` takes `name` and `data`), and the dev server rejects snake_case params.
- OpenAI Agents SDK (`https://openai.github.io/openai-agents-python/`): the `Runner`, the `RunState` serialization the HITL relies on (`result.to_state().to_string()` and `await RunState.from_string(agent, s)`), and `@function_tool(needs_approval=True)`. If the human's floor is the Course #4 `SandboxAgent`, its sandbox-agents and clients pages live on the same docs site.

## Sourcing

When you state something that comes only from this file, cite it as "per AGENTS.md." When Context7 or the Inngest docs disagree with this file, they win. This brief is today's known-good, not a permanent spec.

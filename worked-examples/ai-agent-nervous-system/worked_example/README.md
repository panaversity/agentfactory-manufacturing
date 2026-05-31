# Worked example — the nervous-system build (D0-D6)

The reference build for Part 4 of the
[Give Your AI Agent a Nervous System crash course](https://agentfactory.panaversity.org/docs/ai-agent-nervous-system-crash-course):
a small customer-support worker wrapped, one layer at a time, in an Inngest nervous system.

> **Tier: laptop.** Verified end to end (May 2026) against a live Inngest dev server,
> a real model, and a free Neon database. `inngest` 0.5.18, `openai-agents` 0.17.x,
> Python 3.12. Single host; test data only; not production-hardened. This is the
> answer key, not your starting point: build it yourself from the course first, then
> diff against this when you are stuck.

## Files

| File                | What it is                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.py`          | **D0** — the worker, standalone. OpenAI Agents SDK agent + the `issue_refund` tool (`needs_approval=True`). Imports no Inngest; the nervous system wraps it from outside.                                                                                       |
| `main.py`           | **D1-D6** — the nervous system. The FastAPI host plus the Inngest durable functions: event trigger, daily cron + fan-out, flow control, and the durable human-approval gate (`wait_for_event`, resumed with `RunState.from_string(..., context_override=...)`). |
| `verify_battery.py` | Reproducible end-to-end checks: approve, idempotent re-approve, and reject paths against the audit trail.                                                                                                                                                       |
| `verify_hitl.py`    | Focused check of the durable approval gate (suspend → decide → resume → exactly one refund row).                                                                                                                                                                |

## Run it

Set up as its own uv project, supplying your own keys:

```bash
cp .env.example .env        # then fill in OPENAI_API_KEY and DATABASE_URL
uv sync
```

Start the Inngest dev server in its own terminal (dashboard at `http://127.0.0.1:8288`):

```bash
npx inngest-cli@latest dev
```

Then run the FastAPI host:

```bash
uv run uvicorn main:app --reload --port 8000
```

Run **one** function host at a time against the shared dev server on `:8288`. Drive
events from the dashboard or the dev-server MCP, then run the verify scripts to confirm
each path.

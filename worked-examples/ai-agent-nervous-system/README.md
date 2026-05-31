# Give Your AI Agent a Nervous System (worked example)

The **finished build** for the
[Give Your AI Agent a Nervous System crash course](https://agentfactory.panaversity.org/docs/ai-agent-nervous-system-crash-course)
on The AI Agent Factory. It takes a small customer-support agent and wraps it, one
layer at a time, in an Inngest **nervous system**: an event wakes it, the agent call
runs durably, a daily cron fans out a health check per customer, flow control caps
concurrency and throttle, refunds pause on a durable human-approval gate, and a broken
step retries without redoing finished work.

> **Tier: laptop.** Verified end to end (May 2026) against a live Inngest dev server, a
> real model, and a free Neon database (`inngest` 0.5.18, `openai-agents` 0.17.x,
> Python 3.12). Single host; test data only; not production-hardened. This is the
> **answer key**: do the course yourself first, then read this when you are stuck or
> want to compare. It is deliberately kept out of the release zips.

The standing build contract is in `AGENTS.md`; the architecture mirrors the
"two programs (your agent + the Inngest engine) connected by a thin web wire" model
the course teaches: the agent never imports Inngest, so the nervous system is
swap-ready.

## Layout

```
ai-agent-nervous-system/
├── AGENTS.md            the standing build contract (read on open)
├── .claude/skills/      the four Inngest Skills + neon-postgres, preinstalled
├── .mcp.json            MCP wiring: Neon, Context7, Inngest dev server
├── opencode.json        the same wiring for OpenCode
├── skills-lock.json     pins the installed Skill versions
├── parts_1_3/           concept-verification scripts (the reflexes in isolation)
│   ├── main.py
│   ├── verify_retries.py
│   └── .env.example
└── worked_example/      the full Part 4 build (D0-D6)
    ├── agent.py            D0: the worker, standalone (no Inngest imports)
    ├── main.py             D1-D6: the nervous system (FastAPI host + Inngest functions)
    ├── verify_battery.py   reproducible approve / re-approve / reject checks
    ├── verify_hitl.py      focused durable-approval-gate check
    └── .env.example
```

Each subproject is its own uv project. Copy its `.env.example` to `.env`, fill in your
own `OPENAI_API_KEY` and Neon `DATABASE_URL`, and see `worked_example/README.md` for the
run steps. The `.env` files are gitignored; never commit a filled-in one.

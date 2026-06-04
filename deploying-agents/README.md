# Maya's Tier-1 Support Harness

The companion code for the **Deploy Your Agent Harness to the Cloud** crash course. Maya is a Tier-1 support agent. This repo deploys her as a FastAPI harness on the OpenAI Agents SDK, with durable state, artifact storage, and an optional sandbox.

## What's in this base

```
deploying-agents/
├── pyproject.toml          uv project (Python 3.12, openai-agents 0.17.x)
├── src/maya_harness/
│   ├── settings.py         env config with graceful degradation
│   ├── agent.py            Maya + her two tools
│   ├── runner.py           runs the agent loop, optional sandbox
│   ├── sandbox.py          E2B / Cloudflare sandbox factory
│   ├── state.py            Postgres (asyncpg) or SQLite fallback
│   ├── storage.py          Cloudflare R2 or local-dir fallback
│   └── main.py             FastAPI app: GET /health, POST /runs
├── schema.sql              the five Postgres tables
├── Dockerfile              python:3.12-slim, uv-based
├── infra/                  Azure Container Apps deploy (yaml + script)
├── scripts/smoke.py        POST one message to a running harness
├── Makefile                install / run / smoke / schema / zip
└── .env.example            every key, with what it unlocks
```

## Setup (3 steps)

1. **Open this folder** (clone the repo or download the base zip), then install dependencies:
   ```bash
   make install
   ```
2. **Add your keys.** Copy `.env.example` to `.env` and add at least `OPENAI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
3. **Open the folder in your coding agent** (Claude Code, OpenCode, or similar). It reads `AGENTS.md` and helps you build and deploy. Or run it yourself:
   ```bash
   make run     # serves on http://localhost:8000
   make smoke   # in another shell: POSTs one message to /runs
   ```

## Which key unlocks what

The harness boots with only `OPENAI_API_KEY`. Each extra key turns on one more component.

| Env var(s)              | Unlocks                          | Without it              |
| ----------------------- | -------------------------------- | ----------------------- |
| `OPENAI_API_KEY`        | the agent loop (required to run) | `/runs` returns 503     |
| `E2B_API_KEY`           | E2B sandbox (free tier)          | sandbox disabled        |
| `CLOUDFLARE_WORKER_URL` | Cloudflare sandbox (paid plan)   | sandbox disabled        |
| `DATABASE_URL`          | Neon Postgres durable state      | SQLite file (`maya.db`) |
| `R2_*` (four vars)      | Cloudflare R2 artifact storage   | local `./artifacts` dir |

Check what is active any time:

```bash
curl http://localhost:8000/health
```

## Deploy to the cloud

`infra/deploy.sh` builds the image with `az acr build` (a cloud build, so no local Docker is needed) and creates an Azure Container App with external ingress and scale-to-zero. Set your secrets in the shell first, then:

```bash
OPENAI_API_KEY=sk-... DATABASE_URL=postgresql://... ./infra/deploy.sh
```

Tear down when done: `az group delete --name maya-rg --yes`.

## Notes

- Default model is `gpt-5.4-mini` (the SDK default). Override with `MAYA_MODEL`.
- E2B is the testable sandbox here because it has a free Hobby tier. Cloudflare is the course's primary backend but its Containers need a paid Workers plan.
- Neon's connection string includes `channel_binding=require` (for libpq clients). asyncpg is not libpq-based, so it ignores the parameter and connects fine; `normalize_neon_dsn` trims it only for a tidy DSN. The real footgun: the `-pooler` endpoint drops `search_path`, so use the direct (non-pooler) endpoint when running `make schema`.

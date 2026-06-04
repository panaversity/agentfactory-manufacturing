# maya-harness: coding agent brief for the Deploy Your Agent Harness crash course

You are the coding agent helping a human deploy Maya's Tier-1 Support agent to the cloud (`deploying-agents-crash-course.md`). Your job: write and run code. The human reads, decides, and pastes prompts. You build, boot, and report.

Live SDK docs win on any conflict. See the probe step at the end before you trust any symbol in this file.

## Brief

Deploy Maya's Tier-1 Support agent as a FastAPI harness. The harness is the control plane: it holds the agent loop, durable state, and storage. A sandbox is the execution plane: an isolated place to run code. The five-component stack:

1. **Harness**: a FastAPI app (`GET /health`, `POST /runs`) that runs the agent loop. Boots on Azure Container Apps.
2. **Agent**: Maya, built on the OpenAI Agents SDK, with two simple tools (`lookup_account`, `draft_reply`).
3. **Durable state**: Neon Postgres for sessions, runs, traces, artifacts, and an audit log. SQLite when no database is set.
4. **Artifact storage**: Cloudflare R2 (S3-compatible) with presigned download URLs. A local directory when no R2 is set.
5. **Sandbox**: E2B (free tier, testable) or Cloudflare (course primary, paid plan). Disabled when no key is set; the agent still runs.

The harness must boot with only `OPENAI_API_KEY` set. Every other key unlocks one more component.

## Project rules

Each rule names the failure it prevents. Violate one and the build breaks quietly.

- **Pin `openai-agents>=0.17,<0.18`.** The sandbox area shipped at 0.14, but the current release is 0.17.x. A `~=0.14` pin gives you stale, mismatched symbols. Default model is `gpt-5.4-mini` (since 0.16).
- **Import from `agents`, never `openai_agents`.** There is no top-level `openai_agents` module. `from openai_agents.sandbox import ...` raises `ModuleNotFoundError`. The package is `agents`.
- **Mounts live in `agents.sandbox.entries`, not `agents.sandbox`.** `R2Mount`, `S3Mount`, `GCSMount`, `AzureBlobMount` are all in `agents.sandbox.entries`. Importing them from `agents.sandbox` raises `ImportError`.
- **A passed capabilities list REPLACES the defaults; it does not add.** `Capabilities.default()` returns `[Filesystem(), Shell(), Compaction()]`. If you write `capabilities=[Shell()]` you silently drop `Filesystem()` and `Compaction()`. Keep the default, or concatenate: `Capabilities.default() + [Memory()]` (a `Skills(...)` capability needs a skill source via `skills=`/`from_`/`lazy_from`, not a `name=`).
- **Attach a sandbox through `RunConfig`, not a `Runner.run` kwarg.** There is no `Runner.run(..., sandbox=...)` parameter. The shape is `Runner.run(agent, msg, run_config=RunConfig(sandbox=SandboxRunConfig(client=..., options=...)))`.
- **Each sandbox client needs an options object with its required fields.** `E2BSandboxClient()` pairs with `E2BSandboxClientOptions(sandbox_type="e2b")` (the `sandbox_type` field is required). `CloudflareSandboxClient()` pairs with `CloudflareSandboxClientOptions(worker_url=...)`. The client constructor takes no `options=`; the options ride in `SandboxRunConfig(options=...)`.
- **`channel_binding` needs no special handling.** Neon's copy-paste string includes `channel_binding=require` (MITM protection for libpq clients). asyncpg is not libpq-based, so it ignores the parameter and connects fine with it left in. `normalize_neon_dsn` trims it only for a tidy DSN; it is not a failure to prevent.
- **The Neon `-pooler` endpoint drops `search_path` server settings.** PgBouncer silently ignores it. Schema-qualify every statement (`public.runs`, `public.sessions`), or run migrations against the direct (non-pooler) endpoint.
- **Load `.env` before any module reads env vars.** `settings.py` calls `load_dotenv()` at the top. Import settings before anything that depends on a key.
- **Inherit the parent environment for any subprocess.** When you shell out (deploy scripts, migrations), pass the current environment through so keys and `PATH` survive. A stripped environment is the usual cause of a "key not set" failure inside a child process.

## Architecture

The corrected API shapes, confirmed against the installed SDK (openai-agents 0.17.3):

- **`settings.py`**: env-driven config with graceful degradation flags (`use_postgres`, `sandbox_enabled`, `use_r2`). Reads `OPENAI_API_KEY`, `MAYA_MODEL`, `DATABASE_URL`, `E2B_API_KEY`, `CLOUDFLARE_WORKER_URL`, and the four `R2_*` vars.
- **`agent.py`**: `Agent(name="Maya", instructions=..., model=settings.model, tools=[lookup_account, draft_reply])`. Tools use the `@function_tool` decorator from `agents`. Tool bodies run in the harness process, not in the sandbox.
- **`sandbox.py`**: returns a `SandboxRunConfig` or `None`. E2B path: `SandboxRunConfig(client=E2BSandboxClient(), options=E2BSandboxClientOptions(sandbox_type="e2b"))`. Cloudflare path: `SandboxRunConfig(client=CloudflareSandboxClient(), options=CloudflareSandboxClientOptions(worker_url=...))`. Imports are deferred so the module loads without the optional extras.
- **`runner.py`**: `await Runner.run(agent, message, run_config=RunConfig(sandbox=sandbox))` when a sandbox is set, else a plain `RunConfig()`.
- **`state.py`**: `asyncpg.create_pool(normalize_neon_dsn(dsn))` for Postgres; stdlib `sqlite3` fallback. Five tables, all schema-qualified on the Postgres path.
- **`storage.py`**: `boto3.client("s3", endpoint_url="https://<account_id>.r2.cloudflarestorage.com", region_name="auto")`; `generate_presigned_url` for downloads. Local directory fallback.
- **`main.py`**: FastAPI app with a lifespan that connects and closes `State`. `GET /health` reports active backends. `POST /runs` loads the session, runs the agent, persists the run and trace, optionally writes an artifact, returns the reply. Boots under `uvicorn maya_harness.main:app`.
- **Manifest shape**: `Manifest(entries={path: File()/Dir()/GitRepo()/<Mount>})`. There is no `Manifest(base_image=, mounts=[], resource_limits=, timeout_seconds=)` and no `MountSpec` class. Mounts go inside `entries`.
- **Dependencies**: `openai-agents[e2b,s3]` pulls the E2B client and boto3. Add `openai-agents[cloudflare]` (which pulls aiohttp) only if you switch to the Cloudflare sandbox.
- **Cloud**: Dockerfile on `python:3.12-slim` with `uv`. Deploy via `az acr build` (cloud build, no local Docker) then `az containerapp create` with `--ingress external` and `--min-replicas 0` (scale to zero). Secrets are stored by name and referenced with `secretref:`.

## SDK + CLI probe

Before you trust any symbol named in this brief, confirm it against the installed SDK. The live SDK wins. Run this first:

```bash
uv sync
uv run python -c "from agents import Agent, Runner, RunConfig, function_tool; import agents; print('core ok', agents.__version__)"
uv run python -c "from agents.sandbox import Manifest, SandboxAgent, SandboxRunConfig; print('sandbox ok')"
uv run python -c "from agents.sandbox.entries import R2Mount, S3Mount; print('mounts ok')"
uv run python -c "from agents.extensions.sandbox.e2b import E2BSandboxClient, E2BSandboxClientOptions; print('e2b ok')"
```

If any import fails, introspect the installed package to find the real path and reconcile this brief:

```bash
uv run python -c "import agents; print([n for n in dir(agents) if not n.startswith('_')])"
uv run python -c "import agents.sandbox as s; print([n for n in dir(s) if not n.startswith('_')])"
uv run python -c "import agents.sandbox.entries as e; print([n for n in dir(e) if not n.startswith('_')])"
uv run python -c "from agents.sandbox import SandboxRunConfig; import inspect; print(inspect.signature(SandboxRunConfig.__init__))"
```

Then confirm the cloud CLIs match the docs before you deploy:

```bash
az version
az extension add --name containerapp
az containerapp env create --help | head -5
```

If a release newer than 0.17.3 has shipped, scan the release notes from the installed version forward and reconcile any breaking change. When this brief and the installed SDK disagree, the installed SDK wins. This brief is today's known-good, not eternal.

## API key safety

- Never put a key in code. Read from the environment via `.env`.
- Before any call to a paid model, verify `OPENAI_API_KEY` is set. If unset, stop and tell the human to add it to `.env`. Do not default or invent.
- Never echo a key in a log line or a command's output.

## Sourcing

When you state a version-specific claim from this brief, say "per AGENTS.md..." When the live SDK docs and this brief disagree on syntax, the live docs win.

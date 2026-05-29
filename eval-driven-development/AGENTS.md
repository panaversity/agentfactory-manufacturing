# Eval-Driven Development base: the brief your eval-building agent works from

You build; the human directs and verifies. Write the code, run it, show the command and its output, and prove each step before the next. Past tense means it ran and you saw the result.

You are a **general agent** (Claude Code, OpenCode, or similar): you scaffold the `evals/` tree, build the golden datasets, write the metric suites, wire the CI, launch Phoenix, and verify scores, not just generate code. Drive the whole build from this brief plus the prompts the human pastes.

**Course:** the human works through this course page, pasting build prompts you execute and verify: https://agentfactory.panaversity.org/docs/eval-driven-development-crash-course

**Read the lesson when a build prompt arrives, and never ask which Decision the human is on.** Part 4 of that page is the lab: seven Decisions, each a Plan-then-Execute brief. The Quick Win is Decision 1: scaffold the eval workspace and build the first 50-example golden dataset on THIS base. A prompt that names the golden dataset, the `evals/` tree, or `validate-dataset.sh` is Decision 1. A prompt naming DeepEval output metrics is Decision 2; trace evals or `/v1/evals` is Decision 3; Claudia's envelope or a safety eval is Decision 4; Ragas or TutorClaw is Decision 5; the regression check or the CI workflow is Decision 6; Phoenix observability or the trace-to-eval pipeline is Decision 7. Infer the Decision from the prompt, fetch just that section of the course page, read it, then plan. Read only the section you need; this brief is the durable contract, the page is the step's detail. No web-fetch tool? Say so once and work from this brief plus the prompt.

The human is a learner, not a client: plan before you build, explain in plain language, move one concept at a time, and prefer the simplest honest thing that works, naming what a heavier choice buys when you reach for it. The course prompts are short on purpose; this brief is the context that lets them stay short.

This folder is a bare base, not a project: no `evals/`, no pinned `requirements.txt`, no pre-recorded fixtures. You build them from prompts. The eval SDKs (DeepEval, Ragas, Phoenix, the OpenAI Evals API) move fast; confirm any signature through Context7 or the canonical doc before you write it. This file pins versions and API surface that were known-good on the date in Sourcing; when the docs disagree with it, the docs win.

## This lab is standalone

You do not need a deployed Course 5-8 stack. The dependency-breaker is `maya-stub.py` in this folder: a keyless, no-LLM Python stub that emits three OpenTelemetry trace shapes (a clean Tier-1 refund, the broken wrong-customer refund, and a Claudia delegated-governance decision). It is the agent-under-test for the lab's Simulated track, so Decision 2 has an output to grade, Decision 3 has a trace to grade, Decision 4 has a delegation decision to grade, and Decision 7 has a span to ingest, all without a paid model. A real Worker drafts the actual reply where the stub emits a canned span; the stub exists to be graded and then replaced.

If the human has the real workers from Courses 5-8 (Tier-1 Support, Manager-Agent, Claudia), the **Full-implementation track** points the same evals at those instead. That is the human's own deployment, not a dependency on other course bases existing. Either track runs the identical Decisions; only the source of the graded behavior differs.

## Which runtime is under evaluation

**The Claude Agent SDK is the default runtime under test (Path A).** Maya's Tier-1 Support, Manager-Agent, and Claudia (on OpenClaw) are Claude substrates. **The OpenAI Agents SDK is the documented alternative (Path B).** The split that matters:

- **DeepEval and Ragas are runtime-agnostic.** They score output, tool-use, safety, and RAG behavior the same way regardless of which SDK produced it. They apply identically on both paths.
- **Only the trace layer differs.** On Path A (Claude default) the trace-grading surface is **Phoenix's evaluator framework**, which consumes the Claude Agent SDK's OpenTelemetry traces directly. On Path B (OpenAI) it is the **OpenAI Agent Evals + Trace Grading** surface, where the traces already live. Both produce equivalent trace-eval suites; choose based on where the agents already run, not on marketing.
- **Phoenix is the shared observability surface** (Decision 7) on either path, because both runtimes reach it over OTLP `/v1/traces`.

The `maya-stub.py` traces are vendor-neutral OTLP, so they land in Phoenix on either path and let the human practice the discipline before committing to a runtime.

## The discipline you build

A nine-layer eval pyramid, built bottom-up across the seven Decisions: **output** evals (does the answer address the request), **tool-use** evals (were the right tools called in the right order), **trace** evals (does the reasoning hold up behind a correct-looking output), **RAG** evals (retrieval and grounding quality), **safety** evals (did a delegated decision stay inside its envelope), **regression** evals (did a critical metric drop versus baseline), and **production observability** (real traces flow in, drift surfaces, sampled failures get promoted back into the dataset). The **golden dataset is the load-bearing artifact**: a beautiful framework on a bad dataset measures the wrong thing with rigor. The loop never closes; it sharpens, as production teaches the dataset the failure categories imagination missed.

## Prep the base (the human pastes one prompt; you run the steps)

- **Check the runtimes.** `python3 --version` must be 3.11+ (the eval frameworks). Phoenix's `px.launch_app()` (Decision 7) needs 3.11-3.13; on Python 3.14 launch with `phoenix serve` instead, since arize-phoenix 16.3.0 predates 3.14. `node --version` must be 20+ (the `phoenix` MCP is an `npx` CLI). If either is missing, tell the human; do not try to install it silently.

- **Install the skills.** Run, in this folder:

  ```
  npx skills add https://github.com/anthropics/skills --skill skill-creator mcp-builder --agent claude-code -y
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent claude-code -y
  npx skills add https://github.com/confident-ai/deepeval --skill deepeval deepeval-tracing --agent claude-code -y
  ```

  `skill-creator` and `mcp-builder` scaffold TutorClaw's skills or any custom MCP. `neon-postgres` provisions the pgvector store (Decision 5) and any eval-result tables. `deepeval` and `deepeval-tracing` carry the DeepEval eval-suite and tracing-processor surface. This is the flag form on purpose: the bare `npx skills add owner/repo` shorthand symlinks skills under `.agents/skills/`; the `--agent claude-code` form copies them into `.claude/skills/` (which OpenCode reads too, so one install serves both tools).

  **There is no skill for Ragas, the OpenAI Evals API, the Phoenix Python package, or either agent SDK.** Those surfaces are pinned inline below and confirmed through Context7; do not invent a skill name for them. `npx skills add` drops an unknown skill name **silently with a zero exit**, so a typo never surfaces at runtime. If you change this skill list, confirm each name first with `npx skills add <repo-url> --list` (the exact-name source of truth); do not trust install exit codes.

- **Set up the keys.** Copy `.env.example` to `.env`. The human pastes a graded-runtime key (`ANTHROPIC_API_KEY` for the Claude default, `OPENAI_API_KEY` for the OpenAI path or as the judge). The judge model and the graded model must differ (no self-grading), so a common split is a Claude-graded runtime with an OpenAI judge: set both. Local Phoenix needs no key. Never write a key yourself, never echo it.

- **Bring the MCP servers online.** Neon, Context7, and `phoenix` are declared in `.mcp.json` and `opencode.json`; you do not configure them. Context7 is keyless. Neon authorizes over OAuth: a browser window opens, the human signs in free at neon.com and clicks Authorize, once. The `phoenix` MCP points at the local Phoenix on `http://localhost:6006` and **only resolves once Phoenix is running in Decision 7**, so seeing no Phoenix tools before then is expected, not a failure (the same dormant-until-running pattern other bases use for a local dev server).

- **Then, after Phoenix is up, have the human restart you.** Newly installed skills and the freshly wired `phoenix` MCP do not load mid-session. Once `px.launch_app()` is running (Decision 7), ask the human to exit and relaunch in this folder, then confirm the boundary: list the `phoenix` MCP tools you can see (`list-traces`, `get-spans`, `list-datasets`, `list-experiments-for-dataset`, and the rest). No tools means Phoenix is not running, or the restart has not happened.

## The tool registry (the only valid values for `expected_tools`)

The golden dataset's `expected_tools` field references this list, and Decision 2's tool-use eval validates against it. These are Maya's Tier-1 Support tools:

- `lookup_customer(customer_id)` : fetch profile, plan, tenure, status
- `check_subscription_status(customer_id)` : current plan, billing state, renewal date
- `process_refund(customer_id, amount, reason)` : issue refund within policy
- `check_refund_policy(plan, days_since_charge)` : return refund eligibility
- `search_kb(query)` : knowledge-base lookup for policy/how-to questions
- `get_recent_charges(customer_id, days)` : billing history
- `update_account(customer_id, field, value)` : non-billing profile changes
- `create_ticket(customer_id, category, priority, summary)` : open a tracked case
- `escalate_to_human(ticket_id, reason)` : hand off to a human agent
- `send_email(customer_id, template_id, variables)` : confirmation/notification
- `run_diagnostic(customer_id, area)` : technical-issue diagnostic harness
- `check_outage_status(region)` : current incident-board lookup

## The golden-dataset schema (the load-bearing artifact)

Decision 1 builds 50 examples of Maya's Tier-1 Support traffic. Each example row has:

- `task_id` : unique
- `category` : one of: `refund_request`, `account_inquiry`, `technical_issue`, `escalation_request`, `policy_question`
- `input` : the customer message
- `customer_context` : object with `customer_id`, `plan` (free/pro/enterprise), `tenure_months`, `prior_refunds_30d`, `account_status` (active/suspended), plus any case-specific facts
- `expected_behavior` : natural-language description of what the agent should do
- `expected_tools` : ordered list; the eval treats order as the canonical sequence; values come from the tool registry above
- `expected_response_traits` : rubric items the response should satisfy
- `unacceptable_patterns` : specific things the response should NOT contain
- `difficulty` : `easy` / `medium` / `hard`, for stratified analysis

**Category distribution:** roughly 40% `refund_request` (the most common production category), 20% `account_inquiry`, 15% `technical_issue`, 15% `escalation_request`, 10% `policy_question`. Mix easy/medium/hard within each category. `validate-dataset.sh` checks that every example has all fields, that `expected_tools` references only registry tools, that no two examples share an `input`, and that the distribution holds within +/-5%.

The `maya-stub.py` traces map onto this schema: the clean and broken traces are both `refund_request` rows, and the broken one is the canonical hard case (three name matches, no disambiguation). Claudia's delegation decision feeds the separate `datasets/claudia-delegation.json` in Decision 4.

## Rules that prevent silent failures

These always bind:

- **Local and production stay rigorously separated.** Never write to a production `governance_ledger` or `activity_log` from a test or eval session; use the stub, recorded fixtures, or a clearly-marked staging store. The agent regularly reads traces and writes local databases; the discipline is that "local" and "production" never touch.
- **The golden dataset is an API contract.** Treat any change to `datasets/golden.json` like a contract change: review carefully, version explicitly, justify a changed `expected_behavior` or rubric in the commit. Silent dataset drift is the most common reason an eval suite quietly stops catching real failures.
- **The grader is never the graded model.** Use a different model family for the LLM-as-judge than the one running the agent, or you measure a model agreeing with itself. Pass the judge model by environment variable.
- **Trace export must be confirmed flowing before trace evals.** If traces are not actually reaching the collector, trace evals score an empty dataset and report green. Before Decision 3 (Path A) or Decision 7, send one trace (run `python3 maya-stub.py`) and confirm it lands in Phoenix before trusting any trace-level score.
- **DeepEval 4.x uses `SingleTurnParams`, not `LLMTestCaseParams`.** The old name is a deprecated alias that still imports with a warning; use the new one.
- **`npx skills add` drops unknown skill names silently with a zero exit.** A typo in the install list fails open. Confirm names with `--list` before shipping a change.
- **The `phoenix` MCP only resolves while local Phoenix runs.** No Phoenix tools before Decision 7 is expected. Restart the agent after the first launch so the MCP attaches.
- **Neon MCP is dev-plane only:** provisioning, migrations, and inspection in English, never wired into a runtime path; migrate on a branch (`prepare_database_migration`, then `complete_database_migration`), never untested DDL against main.

## Inline API pins (paste these; do not recall them)

This stack moves fast. The concept is yours; the exact import path, class name, and kwargs are pasted from here or re-confirmed through Context7, never reconstructed from memory.

### DeepEval (4.x; pin `deepeval==4.0.5` or re-check at build time)

- Import test-case params as `from deepeval.test_case import SingleTurnParams` (NOT `LLMTestCaseParams`, a deprecated alias).
- `TaskCompletionMetric` IS a real built-in class in 4.x: `from deepeval.metrics import TaskCompletionMetric`. Do not rebuild task completion with `GEval` unless you want a custom rubric.
- Built-in metrics, all `from deepeval.metrics import ...`: `AnswerRelevancyMetric`, `FaithfulnessMetric`, `HallucinationMetric`, `ToolCorrectnessMetric`, `GEval`, `TaskCompletionMetric`.
- Custom criteria use `GEval`:
  ```python
  from deepeval.metrics import GEval
  from deepeval.test_case import SingleTurnParams
  correctness = GEval(
      name="Correctness",
      criteria="Determine whether the actual output is factually correct based on the expected output.",
      evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT, SingleTurnParams.EXPECTED_OUTPUT],
  )
  ```
  `criteria` and `evaluation_steps` are mutually exclusive.
- For the OpenAI Agents SDK path, the tracing processor is `DeepEvalTracingProcessor`, attached with `add_trace_processor()`:
  ```python
  from agents import add_trace_processor
  from deepeval.openai_agents import DeepEvalTracingProcessor
  add_trace_processor(DeepEvalTracingProcessor())
  ```
  The Claude Agent SDK has no turnkey DeepEval agent processor; instrument it with the generic `@observe` (the `deepeval-tracing` skill) or send its OTel traces to Phoenix.
- `deepeval test run` works and wraps pytest, but plain `pytest evals/output/` works in all versions if the CLI hangs. Either is valid.

### Ragas (pin `ragas==0.4.3` AND `langchain<1.0`; no skill, pin it all)

- **Pin langchain too, or `import ragas` fails.** A fresh `pip install ragas==0.4.3` with no other constraint pulls langchain 1.x, whose `langchain_community.chat_models.vertexai` was removed, so `import ragas` raises `ModuleNotFoundError` before any eval runs. Pin alongside Ragas: `langchain<1.0`, `langchain-community<0.4`, `langchain-core<1.0`, `langchain-openai<1.0` (verified working set: langchain 0.3.30, langchain-community 0.3.31, langchain-core 0.3.86, langchain-openai 0.3.35).
- v1 sample fields: `user_input` / `response` / `retrieved_contexts` / `reference`. The legacy `question` / `answer` / `contexts` / `ground_truth` names emit DeprecationWarnings; use the v1 names.
- `from ragas.metrics import ContextRelevance` (PascalCase). It surfaces in the results frame under the column `nv_context_relevance` (an NVIDIA-style implementation). The old `context_relevancy` (snake) is REMOVED; use `ContextRelevance` or `ContextPrecision`.
- **Use the Langchain wrappers for the LLM and embeddings; the `llm_factory` / `embedding_factory` path NaNs the headline metric in 0.4.3.** Live-verified: `llm_factory` returns an `InstructorLLM` with no `agenerate_text`, so `ContextRelevance` and `AnswerCorrectness` come back all-NaN; a sync `OpenAI()` client also breaks async embeddings. The path that scores all five metrics with zero NaN rows is:
  ```python
  from ragas.llms import LangchainLLMWrapper
  from ragas.embeddings import LangchainEmbeddingsWrapper
  from langchain_openai import ChatOpenAI, OpenAIEmbeddings
  llm = LangchainLLMWrapper(ChatOpenAI(model="gpt-4o-mini"))
  emb = LangchainEmbeddingsWrapper(OpenAIEmbeddings(model="text-embedding-3-small"))
  ```
  (Ragas docs may steer you to the factories for forward-compat; in 0.4.3 they do not work for these metrics, so the wrappers win. Re-check when you bump Ragas.)
- Cap concurrency to stay under the judge's TPM limit, or rows return NaN: `evaluate(..., run_config=RunConfig(max_workers=4))` (`from ragas.run_config import RunConfig`). At 30 examples x 5 metrics on a gpt-4o-mini judge, a default config returns NaN rows.

### OpenAI Evals API (Path B trace + output evals; no skill, pin it all)

- Upload the dataset via the Files API: `client.files.create(file=open("data.jsonl","rb"), purpose="evals")` (`POST /v1/files`, `purpose="evals"`). Each JSONL line is wrapped as `{"item": {...}}`.
- Create the eval: `client.evals.create(name=..., data_source_config={...}, testing_criteria=[...])` (`POST /v1/evals`). The `data_source_config.item_schema` names every column a grader references.
- Run it: `client.evals.runs.create(eval_id, name=..., data_source={"type": "jsonl", "source": {"type": "file_id", "id": "<file_id>"}})`. Retrieve with `client.evals.runs.retrieve(eval_id, run_id)`.
- **Trace Grading is dashboard-only** as of the Sourcing date: there is no public REST endpoint to submit traces programmatically. The working pattern is to serialize trace fields (`tools_called`, `retrieved_context`, `response`) as columns of the same row and grade them inside `/v1/evals` with LLM-as-judge rubrics. The Trace Grading dashboard remains the diagnostic UI.

### Phoenix (local observability; `arize-phoenix==16.3.0`, `@arizeai/phoenix-mcp@4.0.13`)

- Launch in-process for the lab: `pip install arize-phoenix` then `import phoenix as px; px.launch_app()`. The UI and the OTLP-HTTP collector both serve on `http://localhost:6006`; the ingest path is `/v1/traces`; GraphQL is at `/graphql`; gRPC OTLP is on `4317`. No Docker, no key, auth off by default. On Python 3.14, `px.launch_app()` times out (arize-phoenix 16.3.0 predates 3.14): use `phoenix serve` (same UI and collector on :6006) or pin Python to 3.11-3.13. Phoenix routes a trace to a project by the `openinference.project.name` resource attribute, not `service.name`; `maya-stub.py` sets it to `maya-stub`, so the traces land under the `maya-stub` project in the UI.
- The Docker image `arizephoenix/phoenix` is the multi-user production shape only, not the lab one.
- Modern tracing setup: `from phoenix.otel import register; register(auto_instrument=True)` sends to localhost by default; `PHOENIX_COLLECTOR_ENDPOINT` overrides the target.
- Trace landing for the runtimes is via OpenInference instrumentors: `openinference-instrumentation-claude-agent-sdk` (Path A) or `openinference-instrumentation-openai-agents` (Path B). `maya-stub.py` bypasses both: it posts hand-built OTLP spans directly with `opentelemetry-exporter-otlp-proto-http`, the same vendor-neutral route the Simulated track uses for replay.

## What you build vs what ships

The base ships the standing contract only: this brief, `CLAUDE.md`, `README.md`, `.env.example`, `.mcp.json`, `opencode.json`, `maya-stub.py`, and `corpus/`. You build everything else from prompts:

- `requirements.txt` (you pin it in Decision 1): `deepeval==4.0.5`, `ragas==0.4.3` with `langchain<1.0` + `langchain-community<0.4` + `langchain-core<1.0` + `langchain-openai<1.0` (without those constraints `import ragas` fails on langchain 1.x), `openai`, `pytest`. Plus the `evals/` tree, `datasets/golden.json`, `scripts/validate-dataset.sh`, `datasets/README.md`.
- The DeepEval suites, the Ragas suite, the OpenAI Evals (or Phoenix evaluator) trace harness, the safety/envelope metrics, the regression comparator, the CI workflow, the Phoenix query scripts.
- The Simulated-track fixtures are agent-generated, not zip payload: build the pre-record harness (read `golden.json`, call a cheap model OR `maya-stub.py`, write JSON per example to `traces-fixtures/`); build the regression-injection set (degrade 20% of Decision 2 outputs); seed TutorClaw's pgvector store by chunking and embedding `corpus/` into Neon (`text-embedding-3-small` -> `VECTOR(1536)`, cosine `<=>`). These are reproducible artifacts, made once, not shipped.

Do NOT ship a pre-indexed vector tarball or pre-recorded fixture pile; that rots against embedding-model and trace-shape changes and contradicts the defer-to-agent principle. The finished reference solution, if any, lives in `worked-examples/eval-driven-development/`, which the release workflow excludes from the zip.

## Verification (what "done" means at each Decision)

- **Decision 1:** `scripts/validate-dataset.sh` passes on a 50-example `golden.json`: all fields present, `expected_tools` all in the registry, no duplicate inputs, distribution within +/-5%.
- **Decision 2:** the DeepEval output suite runs (`deepeval test run` or `pytest evals/output/`) and produces per-metric scores and a committed `reports/baseline.md`; the broken wrong-customer case is gradable.
- **Decision 3:** trace-level rubrics score the serialized trace rows (Path B `/v1/evals`, or Path A Phoenix evaluators); the wrong-customer trace scores low on tool-selection while its output eval looks fine.
- **Decision 4:** `EnvelopeRespectMetric` passes the in-envelope Claudia decision and fails a genuine violation; the red-team set surfaces at least 3 real catches; confidence < 0.7 that was auto-approved is flagged.
- **Decision 5:** Ragas scores TutorClaw on the five metrics with no NaN rows; the OOD canary (`context_recall` + `context_precision` near zero) fires on an out-of-corpus question.
- **Decision 6:** `scripts/run-all-evals.sh` aggregates Decisions 2-5, `check-regressions.py` flags a critical-metric drop beyond tolerance against the baseline, and the synthetic-regression fixture makes the detector fire before you trust it.
- **Decision 7:** Phoenix is up (`phoenix serve` or `px.launch_app()`); a trace from `maya-stub.py` (or the replay) lands in the `maya-stub` project in Phoenix; the three health-summary query scripts emit markdown; the promotion script turns a sampled trace into a candidate eval example.

## Keys

A graded-runtime key from `.env` (`ANTHROPIC_API_KEY` for the Claude default, `OPENAI_API_KEY` for the OpenAI path), never in code or logs; confirm it is set before any paid-model call, and stop and ask if it is not. The judge model differs from the graded model, so a Claude-graded runtime with an OpenAI judge sets both. Local Phoenix needs no key. `CONFIDENT_API_KEY` is OPTIONAL and OFF BY DEFAULT: only if the human opts into the hosted Confident AI DeepEval MCP (beta), added with `claude mcp add` and never required for any Decision.

## Docs (the references for these tools)

Confirm exact signatures through these before you write code; they move, and they win over this brief:

- DeepEval: https://deepeval.com/docs (metrics at `/docs/metrics-llm-evals`, OpenAI Agents integration at `/integrations/frameworks/openai-agents`). Context7 for the 4.x surface.
- Ragas: https://docs.ragas.io (metrics and the v1 sample schema). No MCP; Context7 confirms the 0.4.x surface.
- OpenAI Evals: https://developers.openai.com/api/docs/guides/evals and `/guides/trace-grading`. The `openai` Python SDK hits the REST API; there is no eval MCP.
- Phoenix: https://arize.com/docs/phoenix (self-hosting auth-off default, the MCP server at `/integrations/phoenix-mcp-server`, OTLP and `phoenix.otel.register`).
- OpenInference instrumentors: https://github.com/Arize-ai/openinference (the `claude-agent-sdk` and `openai-agents` packages, the trace-landing path).
- Context7 MCP confirms any of the above SDK surfaces before you write them.

## Sourcing

When you state something that comes only from this file, cite it as "per AGENTS.md." When Context7 or the tool docs disagree with this file, they win. The version pins and API surface here were verified known-good on 2026-05-29; this brief is today's known-good, not a permanent spec. Re-confirm the fast-moving pins (DeepEval especially) at build time.

# AGENTS.md: Paperclip operations brief

You are the coding agent. The human reading this is doing the **From Fixed to Dynamic Workforce** crash course. Your job is to drive Paperclip end-to-end on their machine while they describe what they want in plain language. This brief is your operating manual: principles you apply on every task, and operations for every common move (install, hire a Worker, send an issue through, fire an approval, walk a hire through the board, pause or retire a Worker, query the audit trail, recover from a failure). PART 1 and PART 2 run a fixed workforce; PART 3 is the new material, the workforce growing itself under approval.

**Course:** the human works through https://agentfactory.panaversity.org/docs/dynamic-workforce-crash-course, pasting short prompts you execute and verify. It assumes a baseline company exists (the Northwind newsletter from the Workforce with Paperclip course: a CEO and a CMO); the course's first prompt stands that baseline up if it is missing, then hires a new Worker into it. Read the relevant Scenario when a prompt arrives; this brief is the durable contract, the page is each step's detail.

PART 2 was verified against a live Paperclip install and re-verified live at v2026.529.0 by running the actual API and CLI; the shapes were observed, not guessed. PART 3's authority and lifecycle facts were re-verified against the `paperclipai/paperclip` repo `master` source at v2026.529.0 (June 2026). Where this brief and the live source disagree on syntax, **the source wins**: Paperclip ships frequently, so these are today-known-good, not eternal. One caveat specific to this product: the hosted docs site (`docs.paperclip.ing`) is JS-rendered and returns thin content to fetchers, so when a fact matters, the repo `master` source (route handlers, schemas, `docs/` in-repo) is the authoritative cross-check, not the rendered site.

The human is not a Paperclip expert. They paste short, humane prompts. Your reply is a plan first, an action second. Run nothing destructive without explicit approval. Show command and output, not just a summary.

## Versions this brief was verified against

```
paperclipai (CLI + server):  2026.529.0 (PART 2 and PART 3 re-verified live and against source; released 2026-05-30)
Node.js:                     20+ required; onboard works on 20-25
docs index:                  https://paperclip.ing/llms.txt
docs site:                   https://docs.paperclip.ing  (JS-rendered/thin to fetchers; cross-check the repo master source)
github:                      https://github.com/paperclipai/paperclip  (master is the authoritative source)
license:                     MIT
```

Re-run `npx paperclipai --version` and `node --version` at install. The version will drift; the operational shapes below are stable enough to start from, then confirm against `--help` and the live API as you go.

## Source of truth, in order

1. `paperclip.ing/llms.txt` and `docs.paperclip.ing` (live docs, fetched fresh per task)
   1b. The installed Paperclip skills (`paperclip-create-agent`, `paperclip`, `diagnose-why-work-stopped`): Paperclip's own maintained knowledge. When this brief and a skill differ, the skill wins (it tracks the product; this brief is a snapshot).
2. This brief (verified against v2026.529.0; may lag on newer syntax)
3. The running install itself: `paperclipai <command> --help`, and probing API validation errors
4. The Paperclip server logs (for diagnosis, not for inferring product shape)
5. The human (when you have a decision they should make)

A recurring rule across this brief: **Paperclip's CLI and API surface drifts, and several CLI commands fail silently** (they print parent help and exit 0 instead of erroring on an unknown subcommand). Never trust a CLI exit code of 0 alone. Read the output. When the API is the reliable path, prefer the API.

---

# PART 1: PRINCIPLES (apply everywhere)

## Critical: discover before you act

Before any non-trivial operation, fetch the relevant live-doc section and confirm the current command shape with `--help`. The table maps intent to where to look.

| If the human wants to...                  | Confirm via                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Install Paperclip                         | `paperclip.ing/llms.txt`, then `npx paperclipai onboard --help`                          |
| Run a second instance on the same machine | `paperclipai run --help` (note: no `--port` flag; port is set in `config.json`)          |
| Hire a Worker                             | `paperclipai agent --help` (note: there is no `agent create` CLI; hire via the REST API) |
| Send an issue to a Worker                 | `paperclipai issue create --help`                                                        |
| Set up an approval                        | `paperclipai approval --help`                                                            |
| Query the audit trail                     | `psql` into the embedded Postgres (connection string assembled from `config.json`)       |
| Diagnose a problem                        | `paperclipai doctor` first, then the server logs                                         |
| Tear down / start clean                   | prefer `POST /api/companies/:id/archive` or a fresh `--data-dir` (see Safety rails)      |

If a `--help` listing or a doc path has clearly changed, surface it to the human and adjust.

## Working pattern (every task)

1. **Read.** Fetch the relevant live-doc section. Confirm the command shape with `--help`. Read the human's request once carefully.
2. **Propose.** State the plan in plain language: what you will do, in what order, where you will pause, what observable success looks like.
3. **Ask.** Get approval before any destructive command. After two clean rounds, ask once for blanket approval of the standard chain; re-acquire per-command approval after any anomaly.
4. **Execute.** Show the command and the output, not just a summary.
5. **Verify.** Confirm the observable success. If a row should appear in the activity log, query it and show it.
6. **Fix.** On failure, read the error, name it in plain language, propose the fix, ask, execute, verify.

## Past tense is for completed actions only

"I will create the company" names intent. "I have created the company; its id is `<id>` and `GET /api/companies` now returns it" names a completed, verifiable action. Never use past tense before you have executed and observed the result. The most common failure mode of capable models is producing a polished "I have done X" before doing X.

## Trust progression

- **Rounds 1-2**: ask before each destructive command. Show the command, the expected effect, what you will check after.
- **Round 3+** (clean track record): ask once for blanket approval of the standard chain. Even with blanket approval, never collapse to silent execution. Show command and output for each.
- **Re-acquire per-command approval** after any anomaly: an unexpected error, an unrecognized output, a state you don't recognize.

## Safety rails (non-negotiable)

- **Company deletion now has real handlers, but prefer `archive` for a clean slate.** As of v2026.529.0 a real `DELETE /api/companies/:id` handler exists (board-only; returns `{ ok: true }`), and so does a soft-delete `POST /api/companies/:id/archive`. Earlier this brief said `company delete` was an un-cascaded 500; that is no longer the route's documented state. BUT whether `DELETE` cascades cleanly versus 500s on a foreign-key constraint under real data is **runtime-unverified** (the handler is wired in source; it was not run against a populated DB). So treat `DELETE` as "exists, unproven under data" and prefer `POST /api/companies/:id/archive` (the safe, reversible path), or a fresh `--data-dir` for a guaranteed-clean instance. Agents have a full lifecycle API (all board-only): reconfigure via `PATCH /api/agents/:id`, and `pause` / `resume` / `terminate` / `DELETE` an agent via the routes in PART 3.
- **Never `sudo` anything related to Paperclip.** It is a user-local install. If something owned by another user (especially `root`) is blocking you, STOP and surface to the human; privileged cleanup is theirs.
- **Never write API keys (Anthropic, OpenAI, Gemini, etc.) to a file inside the project or to any committed file.** Export them in the shell, reference by env var. If the human pastes a key into chat, name the security issue, advise rotation, proceed without echoing it.
- **Never start a paid-model adapter by default.** When a scenario needs a real LLM Worker, default to the cheapest current capable model (Gemini Flash, Haiku, GPT-mini-class) and use a free tier where one exists. Never default to Sonnet/Opus/GPT-5 without explicit human approval.
- **The embedded Postgres is for reading, not writing.** Use `psql` to query the audit tables. Never manually `DELETE`/`UPDATE`/`INSERT` to force a state the product's own API cannot reach. If the API can't do it, surface that to the human; do not reach around it with SQL.
- **Never claim a runtime adapter is available without checking.** Run `GET /api/adapters` (or the dashboard's adapter list) and read the actual set before recommending one.

## Secrets discipline

Export-then-reference, every time: the human runs `export <PROVIDER>_API_KEY="..."` in the shell (whichever the chosen adapter needs) and you reference it by name, never inline the value. Never echo keys to chat, never commit them. The hired Worker in this course runs a real model on a local adapter (`claude_local`/`opencode_local`), so the provider credential lives in that CLI's own auth (or your shell), never in a file and never in `adapterConfig.env` (Paperclip echoes that back in plaintext).

## Sourcing claims that exist only in this brief

When you cite a framing or recommended default that comes from this file rather than Paperclip itself, preface it ("AGENTS.md says..."). The human can fact-check a cited claim, not a laundered one. Verifiable Paperclip facts (the install command, adapter behavior) need no preface.

---

# PART 2: OPERATIONS (verified live against 2026.529.0)

## Prep the base (the human pastes one prompt; you run the steps)

Install Paperclip's own operator skills so you work from Paperclip's maintained knowledge, not just this brief. Run, in this folder:

```
npx skills add https://github.com/paperclipai/paperclip --skill paperclip-create-agent paperclip diagnose-why-work-stopped --agent claude-code -y
```

`paperclip-create-agent` is the hire-flow authority, `paperclip` the heartbeat and `PAPERCLIP_APPROVAL_ID` reconcile authority, `diagnose-why-work-stopped` the recovery forensics. They install into `.claude/skills/` (OpenCode reads it too); restart so they load. If the multi-`--skill` form changes, fall back to the per-skill tree URL `.../tree/master/skills/<name>`.

## Install and onboard

### Pre-install probe (MANDATORY: run before any install)

```bash
node --version                                              # need 20+
which -a paperclipai; npx paperclipai --version 2>/dev/null # prior install? (first run downloads, ~30-60s)
ls -la ~/.paperclip 2>/dev/null                             # prior data dir?
lsof -nP -iTCP:3100 -sTCP:LISTEN; lsof -nP -iTCP:54329 -sTCP:LISTEN  # ports busy? (API, embedded Postgres)
# running paperclips + where each launched from (disambiguates "my other project on :3100"):
ps -ef | grep -i paperclip | grep -v grep
for pid in $(pgrep -f 'paperclipai onboard|paperclipai run'); do
  echo "pid $pid cwd: $(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd"{print $NF;exit}')"; done
```

First-run note: `npx paperclipai --version` **downloads the package** on a clean machine (30-60 seconds, with a wall of upstream `npm warn deprecated` lines that are not Paperclip errors). The version number printed last is the success signal. Tell the human this before they think it has hung.

STOP and surface to the human if the probe finds: a Paperclip process owned by `root` or another user; a different `paperclipai` already on PATH; ports 3100/54329 held by something else; or a populated `~/.paperclip/` that is the human's prior work. The cwd-attribution step disambiguates "my prior install" from "my other Paperclip project on this same machine" (a real case: each project uses port 3100 and `~/.paperclip` by default).

### The onboard flow

```bash
npx paperclipai onboard --yes [--data-dir <path>] [--bind lan|tailnet]
```

What it actually does (verified):

- Downloads the CLI on first run (or uses a cached copy).
- Sets up an embedded Postgres under `<data-dir>/instances/default/db/`, where `<data-dir>` is `--data-dir <path>` if you passed it, or `~/.paperclip` if you did not.
- Runs `doctor` (a 9-check diagnostic) and then **starts the server automatically**. There is no "onboard but don't start" mode: `onboard --yes` always launches a server. The `--run` flag is documented as opt-in but the server starts regardless; you can omit `--run`.
- **Auto-hops busy ports.** If `:3100` (or `:54329`) is in use, onboard picks the next free port and logs `Requested port is busy; using next free port`. The hop is runtime-only: it is not written back to `config.json`. For a deterministic second instance, edit `config.json` yourself (see Configure).
- Prints a summary banner (Server port, API URL, UI URL, Database path + port, Config path, auto-enabled DB backup; default heartbeat interval is 30s).
- In `--bind lan` or `--bind tailnet` modes, issues a bootstrap API key. In the default `loopback` mode, **no bootstrap key is issued** (auth is trust-based on the loopback connection); the health endpoint reports `bootstrapInviteActive: false`. Do not go looking for a key in loopback mode; there isn't one.

**Capture `PAPERCLIP_API_URL` as the bare host only (a real trap).** The banner labels its API line `http://127.0.0.1:3100/api`, but every route here is written `$PAPERCLIP_API_URL/api/...`, so keeping the `/api` suffix yields `.../api/api/...` and a 404. Capture `PAPERCLIP_API_URL=http://127.0.0.1:3100` (bare host + port, whatever onboard bound), no `/api` suffix.

Capture into a project-local file (never chat): `PAPERCLIP_API_URL` (bare host), the UI URL, the data-dir path, the embedded Postgres port, the config-file path, and (lan/tailnet only) the bootstrap key.

### The `--data-dir` flag is the real "isolate this install" mechanism

`--data-dir <path>` puts the whole instance (db, config, secrets, logs) under that path instead of `~/.paperclip`. Use it whenever the probe finds an existing `~/.paperclip/` to leave alone, or to run more than one Paperclip on a machine.

### Verifying onboard succeeded

1. `curl -sI $PAPERCLIP_API_URL/api/health` returns a status line (not `Connection refused`).
2. `curl -s $PAPERCLIP_API_URL/api/health` returns `{"status":"ok", ...}`.
3. The dashboard URL renders in a browser (onboard often opens it automatically).

(`$PAPERCLIP_API_URL` is the bare host you captured above, with no `/api` suffix; the `/api/` in the route is added here.)

If onboard exits without binding ports and `<data-dir>/instances/default/db/` is empty with no error in the log, this is a known initialization hiccup. Recovery: `rm -rf <data-dir>` and re-onboard. Do not try to repair the half-state.

## Configure

### Second instance, and keeping the server alive

To run a second instance on a machine already using `:3100`, edit the new instance's `config.json` (`<data-dir>/instances/default/config.json`): move BOTH `server.port` and `database.embeddedPostgresPort` (the Postgres port collides too), then `paperclipai run --data-dir <path>`. `paperclipai run` is a long-lived foreground process; when backgrounding it use a real detach (`nohup ... & disown`), not `> logfile 2>&1 &` (some harnesses reap a process whose stdout only goes to a file).

### Common config

- **Telemetry opt-out**: `PAPERCLIP_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.
- **Data directory**: `<data-dir>/instances/default/` holds `config.json`, `db/`, `logs/`, `secrets/`, `data/`. The logs the universal recovery prompt reads are at `<data-dir>/instances/default/logs/`.
- **Telemetry, backups**: DB backup auto-enables (60-minute interval); you do not need to set up a separate one.

## Companies

A **company** is the top-level Paperclip entity. One deployment can run many; data is company-scoped. For the crash course, one company is enough.

Onboard creates the _instance_, not a company. Creating the first company is a separate step.

### Create a company

There is no `paperclipai company create` CLI command. Use the REST API:

```bash
curl -X POST "$PAPERCLIP_API_URL/api/companies" \
  -H "Content-Type: application/json" \
  -d '{"name": "Northwind", "description": "Launch a weekly AI newsletter and reach 1000 subscribers in 90 days.", "budgetMonthlyCents": 2000}'
```

The field is `description`, **not** `mission`. Unknown fields are silently dropped (a wrong field name fails quietly, not loudly). The response includes the company `id` and an `issuePrefix` (e.g. `NOR`); capture both. Company-level budget is `budgetMonthlyCents` (an integer, in cents).

### Goals and projects (optional)

A goal has projects, a project has issues; one of each is enough for the course. Create via `POST /api/companies/:id/goals` (takes a `title`) and `POST /api/companies/:id/projects` (takes a `name`).

## Agents (Workers) and adapters

A **Worker** in Paperclip is a configured role: a name, a runtime (the adapter), permissions, a budget, a heartbeat schedule. The runtime is the adapter.

### The real adapter list

Run `GET /api/adapters` against the running install to see the current set; do not trust any hardcoded exhaustive table here, because the roster moves fast (recent additions include `acpx_local`, `grok_local`, and the plugin adapter `droid_local`). As of the v2026.529.0 source the built-in set is roughly: `acpx_local`, `claude_local`, `codex_local`, `cursor` / `cursor_local`, `cursor_cloud`, `gemini_local`, `grok_local`, `hermes_local`, `http`, `openclaw_gateway`, `opencode_local`, `pi_local`, `process`. **There is no `bash` adapter, and there is no "Claude Managed Agents" billing substrate** (see "How a Worker runs and bills" below). The two builtin no-LLM adapters are:

- **`process`** (the default): runs a command each heartbeat (no LLM). The issue is NOT handed to it, so it must query the API for its work. Fine to prove a heartbeat fires, not to complete an issue.
- **`http`**: POSTs the heartbeat (carrying the full issue payload) to a `url` you host. The shape a self-hosted Agent SDK Worker uses (PART 3's managed alternative).

The LLM-runtime adapters (`claude_local`, `codex_local`, `gemini_local`, etc.) drive a real model. They are what you switch to when a Worker must do real reasoning.

### How a Worker runs and bills (the three runtimes that matter, and a myth to drop)

There is **no "Claude Managed Agents" substrate and no Paperclip session-hour billing.** If you see that phrase anywhere, treat it as either a hosted Paperclip-cloud offering that is not in the open-source product, or a confusion with `cursor_cloud`; do not assert it as a real Paperclip-Claude primitive. The runtimes the course actually uses:

- **`claude_local`** runs the local `claude` CLI headless, bring-your-own auth (your Claude login on the machine). Paperclip does **not** bill you; the credential lives in the CLI's own auth, never in a file. Safe with `model` omitted (uses the local default).
- **`opencode_local`** runs the local `opencode` CLI headless, also bring-your-own auth. It **requires an explicit `model` id** (a `provider/model` slug); the auto-default at the time of writing was `openai/gpt-5.2-codex`, which drifts and may not exist in your install, so always set a real id from `opencode models`.
- **`cursor_cloud`** is the one hosted runtime, billed by Cursor's per-run model, not by Paperclip. The course does not use it; it is named here so you recognize it as the genuine hosted option (not "Claude Managed Agents").

For the local adapters, Paperclip assumes the CLI is already installed and authenticated on the host. Authority and budget are never pushed to a Worker; it queries the API to learn them.

### Hiring a Worker (the verified create body)

There is no `agent create` CLI (running it prints parent help and exits 0, the silent-fail pattern). Hire via the REST API: `POST /api/companies/:id/agents`. The verified field set:

```json
{
  "name": "Reply Drafter",
  "title": "Reply Drafter",
  "role": "general",
  "adapterType": "http",
  "adapterConfig": { "url": "http://127.0.0.1:8899/heartbeat" },
  "capabilities": "Drafts replies to reader mail from a self-hosted agent; escalates anything needing a human to the board.",
  "permissions": { "canCreateAgents": false },
  "budgetMonthlyCents": 50,
  "runtimeConfig": {
    "heartbeat": {
      "enabled": true,
      "intervalSec": 60,
      "wakeOnDemand": true,
      "maxConcurrentRuns": 20
    }
  }
}
```

Field notes:

- **`role`** is a fixed enum (`ceo`, `cto`, `cmo`, `cfo`, `security`, `engineer`, `designer`, `pm`, `qa`, `devops`, `researcher`, `general`); there is no support value, so use `general` and put the real job in `capabilities` + `title`.
- **`capabilities`** is a free-text string (`z.string()`), not a structured object. It DESCRIBES what the Worker is for; it is **not** the enforcement mechanism. Real, server-enforced authority lives in Paperclip's permission-grant + scope + execution-policy layer (see "Authority: what is enforced vs what is prose" in PART 3), not in this prose. There is no `authority_limits` field on the agent record.
- **`permissions`** is an object (`{"canCreateAgents": bool}`); **`budgetMonthlyCents`** is a single integer in cents; **`runtimeConfig.heartbeat`** holds `enabled` / `intervalSec` / `wakeOnDemand` / `maxConcurrentRuns`.
- **`adapterType`** + **`adapterConfig`** (camelCase): `http` -> `{"url": "..."}`, `process` -> `{"command": "sh", "args": ["-c", "..."]}`.

Only `name` is strictly required; everything else has defaults (and a bare `{"name": "..."}` defaults `adapterType` to `process`).

**Agents are mutable via the top-level route** `PATCH /api/agents/:agentId` (re-verified live on 2026.525.0): you can change `budgetMonthlyCents`, `adapterType`, and `adapterConfig` after creation, and each change is revisioned with rollback (`/api/agents/:agentId/config-revisions/.../rollback`); the activity log records `agent.updated`. The route is **top-level** (`/api/agents/:id`), NOT nested: `GET`/`PATCH` on `/api/companies/:id/agents/:agentId` returns 404, which earlier drafts mistook for 'agents are immutable.' A Worker can also be **removed**: `DELETE /api/agents/:id` exists (plus the `pause` / `resume` / `terminate` verbs; see PART 3). For a fully clean instance-wide slate, a fresh `--data-dir` is still simplest. Verify a Worker via `GET /api/companies/:id/agents` (list) or `paperclipai agent get <id>`. `paperclipai agent list` needs `-C/--company-id`.

### How a Worker gets work and resolves it

For the local adapters this course uses (`claude_local`/`opencode_local`), Paperclip spawns the CLI each heartbeat and the CLI reads its assigned work from the API (e.g. `GET /api/agents/me/inbox-lite`); there is no inbound URL. (The `http` adapter is the other shape: Paperclip POSTs the issue payload to a `url` you host, the self-hosted Agent SDK path.) Authority and budget are never pushed to a Worker; it queries the API to learn them.

Either way a Worker resolves its issue by posting a disposition: `PATCH /api/issues/:issueId` with `{"status": "done", "comment": "..."}` (top-level route, not nested; loopback needs no auth header). **A Worker that runs but posts no disposition gets escalated to `blocked`** (the orchestration detects "succeeded but no disposition"). That is the management plane working, not a bug, so a Worker's instructions must always reach a final disposition (`done`, `in_review`, or `blocked`).

## Issues and assignment

An **issue** is a tracked unit of work: id, `identifier` (e.g. `NOR-1`), title, description, status, priority, optional project/goal links, optional `assigneeAgentId`.

### There is no routing-rule engine

Paperclip has no trigger-condition-action router (`/routing`, `/rules`, `/assignments` all 404). `routines` is NOT a router; it is a real, shipped recurring-work system (see "Routines" below). **Assignment is direct: set `assigneeAgentId` on the issue.**

### Create an issue and assign it (assignment must be at create-time)

Assigning a Worker **at create-time** is what wires the issue into heartbeat orchestration:

```bash
paperclipai issue create -C <company-id> --project-id <project-id> \
  --title "Refund request from C-4429" \
  --description "Hi, the product arrived damaged..." \
  --assignee-agent-id <worker-id>
```

A create-with-assignee issue is born at `todo` and the next heartbeat picks it up. Assigning an existing `backlog` issue via `issue update` does **not** trigger pickup. (Default status on a plain create with no assignee is `backlog`.) `issue create` accepts `-C/--company-id`; `issue update` does not (a CLI inconsistency). The issue identifier is `<PREFIX>-<N>`, e.g. `NOR-1`.

### Firing a heartbeat immediately

`paperclipai heartbeat run -a <agent-id> --source assignment` fires a heartbeat now instead of waiting for the schedule. Useful for demos.

### The issue lifecycle

An assigned issue goes `todo -> in_progress` (checked out: `startedAt` + `checkoutRunId` set) and then `done` (`completedAt` set) once the Worker posts a `done` disposition. Atomic checkout means only one Worker can hold an issue at a time.

## Routines (recurring work, a real shipped primitive)

Routines are real and shipped, not curriculum. A routine fires recurring work on a **schedule (cron), webhook, or API call**, and each run creates a tracked issue assigned to an agent. The course's monthly-audit and next-course hooks depend on this being real, so do not model it by hand.

- **Create:** `POST /api/companies/:companyId/routines` with `title`, `assigneeAgentId` (required), `projectId` (required), `priority`, `status` (`active` / `paused` / `archived`).
- **Triggers** are first-class typed objects (`RoutineTrigger`): a `kind` of cron / webhook / api, with `cronExpression` for cron, and `webhookUrl` + `webhookSecret` + a `signingMode` for webhook triggers.
- **Concurrency policy:** `coalesce_if_active` (default) / `skip_if_active` / `always_enqueue`. **Catch-up policy:** `skip_missed` (default) / `enqueue_missed_with_cap`.
- Routines are revisioned (`GET /api/routines/:id/revisions`, optimistic `baseRevisionId` -> `409 Conflict` on a stale write), and each run creates a tracked issue, so the audit trail shows the work. Governance: an agent can only create or update routines assigned to itself; a board operator can assign any agent.

Confirm the exact field names against the live daemon and the `paperclip` skill (`docs/api/routines.md`) before relying on them; this layer also moves.

## Approvals

An approval is a tracked board decision. Real API: `GET/POST /api/companies/:id/approvals` (company-scoped; there is no `/issues/:id/approvals`).

Create body:

```json
{
  "type": "request_board_approval",
  "payload": { "action": "issue_refund", "amount": 800, "rationale": "...", "alternativesConsidered": [ ... ] }
}
```

- **`type`** is a fixed enum: `hire_agent`, `approve_ceo_strategy`, `budget_override_required`, `request_board_approval`. For "a Worker action exceeded its authority," use `request_board_approval`.
- **`payload`** is free-form: whatever structured rationale you put in is stored verbatim. Put the action, amount, rationale, and alternatives here.
- Issue linkage is via `--issue-ids <csv>` on the CLI (`paperclipai approval create -C <cid> --type request_board_approval --issue-ids <id> --payload '{...}'`), stored as `issueIds`. There is no top-level `issueId` field.

The decision flow: create -> `pending`; `paperclipai approval approve <id>` -> `approved` (or `approval reject <id>` -> `rejected`), with `decidedByUserId` and `decidedAt` set. The activity log records `approval.created` and `approval.approved` / `approval.rejected` cleanly.

**An approval is a decision record, not a state machine.** Approving a request does NOT automatically change the linked issue's status or execute the approved action. There is no "approval granted -> issue unblocked -> refund executed" wiring. Acting on an approved decision is a separate step. When you explain this to the human, be honest: the value of the approval flow is the _audited record of who decided what and why_, not an automated unblock.

A non-LLM `process` Worker will not _organically_ file an approval (it takes no authority-exceeding action); a real LLM Worker reasoning about a risky action is what files one organically. The board (the human) can also create an approval request directly.

## Budgets

Budget is set as `budgetMonthlyCents` at company and agent create time. It is consumed only when a Worker does **billable LLM work**: a non-LLM `process` Worker generates zero cost (firing heartbeats at it never moves `spentMonthlyCents`). There is no `cost_events` REST endpoint as of v2026.529.0 (`/cost-events`, `/costs`, `/usage` all 404). Per-run cost lands in the `heartbeat_runs.usage_json` column, `null` for non-LLM adapters.

The practical consequence for this course: the hired Worker runs on `claude_local`/`opencode_local` (real LLM work), so it DOES accrue cost you can watch against `budgetMonthlyCents` (cost lands in `cost_events`; see Audit trail).

## Audit trail

The audit lives in the embedded Postgres. There is **no `paperclipai db connection-string` command**; assemble the connection string from `config.json`:

```
postgresql://paperclip:paperclip@127.0.0.1:<embeddedPgPort>/paperclip
```

(user, password, and database name are all `paperclip`; the port is `database.embeddedPostgresPort` from `config.json`).

### `activity_log` (verified columns)

`id, company_id, actor_type, actor_id, action, entity_type, entity_id, agent_id, details, created_at, run_id`. There is **no `issue_id` column and no `authority_id` column** (older drafts invented both). To query a specific issue's history, filter on `entity_type = 'issue' AND entity_id = '<issue-id>'`. The `action` values are dotted namespaces, not snake_case verbs: `company.created`, `goal.created`, `project.created`, `agent.created`, `issue.created`, `issue.updated`, `issue.comment_added`, `budget.policy_upserted`, `approval.created`, `approval.approved`, `approval.rejected`, `heartbeat.invoked`, `environment.lease_acquired`, `environment.lease_released`, and the handoff escalations `issue.successful_run_handoff_required` / `issue.successful_run_handoff_escalated`. `actor_type` is `user`, `agent`, or `system`.

A useful first query (the "what happened, in order" view):

```sql
SELECT created_at, actor_type, actor_id, action, entity_type, entity_id
FROM activity_log
WHERE company_id = '<company-id>'
ORDER BY created_at;
```

To reconstruct one issue's timeline: `WHERE entity_type = 'issue' AND entity_id = '<issue-id>'`, plus any `details ->> 'issueId'` matches for related rows.

### `cost_events` (table exists; no API)

The `cost_events` table is real even though no REST endpoint exposes it. Verified columns: `id, company_id, agent_id, issue_id, project_id, goal_id, billing_code, provider, model, input_tokens, output_tokens, cost_cents, occurred_at, created_at, heartbeat_run_id, biller, billing_type, cached_input_tokens`. **Cost is `cost_cents` (an integer), not `cost_usd`.** The table is empty for non-LLM adapters; it populates only when an LLM-runtime adapter does billable work.

The "what did this company cost today" query, against the real schema:

```sql
SELECT SUM(cost_cents) / 100.0 AS total_usd
FROM cost_events
WHERE company_id = '<company-id>'
  AND occurred_at >= CURRENT_DATE;
```

### `heartbeat_runs`

The real per-run record (~40 columns; in the database they are snake_case, like the other tables here: `status, invocation_source, trigger_detail, exit_code, signal, stdout_excerpt, stderr_excerpt, log_ref, liveness_state, process_pid, result_json, usage_json`, ...). Also `heartbeat_run_events` and `heartbeat_run_watchdog_decisions`. The CLI `paperclipai activity list` returns the activity log as clean JSON without psql.

## Diagnose and recover

### First move: `paperclipai doctor`

```bash
paperclipai doctor             # 9-check diagnostic
paperclipai doctor --repair    # apply autoremediations (the flag is --repair / -y, not --fix)
```

Doctor runs the same checks onboard runs internally. Most diagnostics start here, not with raw log reading.

### The most common failures

1. **Port in use.** Another Paperclip (yours or a sibling project), or an unrelated service. Run the pre-install probe with the cwd-attribution step to disambiguate. Onboard auto-hops the port; for a deterministic second instance, edit `config.json` (see Configure).
2. **Stale data directory.** A prior `<data-dir>/instances/default/` from an older version. Surface to the human; use `--data-dir <new-path>` for the new install and leave the old one untouched, or back it up and re-onboard.
3. **No provider auth.** A `claude_local`/`opencode_local`/`gemini_local` Worker heartbeats but fails because the spawned CLI is not signed in (or the key is not in the environment). The activity log shows the failure. Fix: authenticate the CLI (`claude`, or `opencode auth`) or export the key, then re-run.
4. **Worker heartbeats but the issue never reaches `done`.** For a local adapter, the spawned CLI ran but posted no disposition, so Paperclip escalates the issue to `blocked`. Fix: the Worker's instructions must always end by posting a disposition (`PATCH /api/issues/:id` with `done` / `in_review` / `blocked`). For an `http` Worker, also confirm the endpoint at `adapterConfig.url` is reachable.
5. **Onboard exits with an empty `db/` directory and no clear error.** A known initialization hiccup. Recovery: `rm -rf <data-dir>` and re-onboard. Do not try to repair the half-state.
6. **A probation Worker's run fails with `409 Issue run ownership conflict` or `error_max_turns`, even though its work looks right.** Concurrent runs are racing for the trial issues (a scheduled heartbeat plus a manual `heartbeat run`, or `maxConcurrentRuns > 1`), and/or `maxTurnsPerRun` is too low so the Worker spends its turns recovering. Fix: see "Run the probation cleanly" in PART 3 (`heartbeat.enabled: false`, `maxConcurrentRuns: 1`, `maxTurnsPerRun` about 15-20, one issue per run). The model's work can be perfect while the run still fails on this, so read the disposition and the run transcript, not just the run status.

### When something fails, or you are unsure

Do not keep retrying variations of the same command. Stop, and either fetch the live docs for the section that names your intent (confirm the shape with `--help`), ask the human, or run a small read-only probe. The universal recovery prompt the human can always paste:

> Something didn't work. Run `paperclipai doctor`, then read the most recent server log under `<data-dir>/instances/default/logs/`, tell me in plain language what you see, and propose a fix I can approve.

---

# PART 3: HIRING & LIFECYCLE (this course; verified against the live `paperclip-create-agent` skill + source, and live-tested end to end at v2026.529.0)

PART 2 ran a FIXED workforce. This course adds the loop where the workforce grows itself: detect a gap, draft a hire, walk it through the board, provision a new Worker, and later pause or retire it. **The approval primitive from PART 2 is reused unchanged; only the payload is richer.** The canonical authority for the hire flow is the installed `paperclip-create-agent` skill; the wake/reconcile loop authority is the `paperclip` skill. When this brief and those skills differ, the skills win.

## Flip the gate first

On a default company, hires skip the board. Turn the gate on once, per company:

```bash
curl -X PATCH "$PAPERCLIP_API_URL/api/companies/<id>" -H "Content-Type: application/json" \
  -d '{"requireBoardApprovalForNewAgents": true}'
```

Verify: a hire now returns `agent.status = "pending_approval"`. If it returns `idle`, the gate is still off and the whole narrative of this course collapses. This single company boolean is the ONLY built-in **hire-gating** lever Paperclip has: there is no native per-class or per-role auto-approval policy that lets one class of future hires skip the board while another does not. That finer "pre-approve this class of hires" rule is still curriculum discipline you model on top. (Authority on what a Worker may DO once hired is a separate, real, server-enforced system; see the next section.)

**The gate is global, so order matters for the baseline.** Once it is on, even the direct `POST /api/companies/:id/agents` route is refused (`409 Direct agent creation requires board approval. Use .../agent-hires`), not only the `agent-hires` flow. So stand up the baseline fixed team (the CEO and CMO) BEFORE you flip the gate, or create them through `agent-hires` + approve. If you flip the gate first and then try to seed the fixed team with `/agents`, you hit that 409. (Verified live, v2026.529.0.)

## Authority: what is enforced vs what is prose (READ THIS)

This is the correction that matters most in the June 2026 redesign. An earlier draft of this brief said "Paperclip has no real authority primitive; authority is only free-text prose in `capabilities`." **That is now wrong.** Between v2026.512.0 and v2026.529.0 Paperclip shipped a real, server-enforced authority layer. Teach the distinction below; do not tell the human authority is "just prose."

- **`capabilities` is still free-text (`z.string()`) and is a DESCRIPTION, not enforcement.** It tells the Worker what it is for. It does not gate anything server-side.
- **Real authority is a permission-grant + scope + execution-policy system:**
  - A `principal_permission_grants` table holds company-scoped grants keyed by principal (`user` or `agent`) + permission key, each with a JSONB `scope` allow-list.
  - An enumerated `PERMISSION_KEYS` set governs what can be granted: `agents:create`, `environments:manage`, `users:invite`, `users:manage_permissions`, `tasks:assign`, `tasks:assign_scope`, `tasks:manage_active_checkouts`, `joins:approve`. **This layer is brand-new and evolving, so before relying on an exact key, confirm `PERMISSION_KEYS` against the live source (`packages/shared/src/constants.ts`).**
  - An `authorization.ts` service returns structured allow/deny decisions with reasons: `allow_explicit_grant`, `deny_missing_grant`, `deny_scope`, `deny_policy_restricted`. Scopes are evaluated with prefix-matching allow-lists, so a grant can be narrowed to specific projects or agents.
  - A per-issue **execution policy** (`authorizationPolicy` with `agentVisibility` / `assignmentPolicy` / `protectedAgent` / `managedBy`, plus review/approval stages recorded in `issue_execution_decisions`) can force delivered work through a review/approval stage at runtime. This is enforcement on WORK, intercepted by the runtime, not prose the agent must remember.
- **Mutating an agent's authority through the API:** `PATCH /api/agents/:id/permissions` (the agent record carries a thin `{ canCreateAgents, canAssignTasks }` object) writes into the grant system via the authorization service. So authority is mutable through grants and scoped policy, not only through the prompt.
- **Reading a Worker's actual authority (verified live, v2026.529.0):** it comes back inline on the agent, there is no separate route (a `GET /api/agents/:id/permissions` is 404). `GET /api/agents/:id` returns `.permissions` (the thin `{ canCreateAgents }` flags) and `.access.grants` (the real list: each `{ permissionKey, scope, grantedByUserId }`), plus `.access.taskAssignSource` (e.g. `explicit_grant`). That `.access.grants` list, with its keys and scopes, is exactly what to show the human in Scenario 3 when they ask what the Worker is truly allowed to do, contrasted against its free-text `capabilities`.
- **Default authority and how to extend it (verified live, v2026.529.0):** a new hire defaults to a single `tasks:assign` grant and `canCreateAgents: false`, a sane minimal specialist authority you do not have to set, so "minimal grants" is the starting point, not something you dial down. To EXTEND authority after a probation, `PATCH /api/agents/:id/permissions` (its body REQUIRES BOTH `canCreateAgents` and `canAssignTasks` as booleans; verified live, `{"canCreateAgents":true,"canAssignTasks":true}` returns 200 and flips `canCreateAgents` to true). To raise the budget, `PATCH /api/agents/:id` with `budgetMonthlyCents`. So a probation in practice is: approve with a tiny `budgetMonthlyCents`, watch the first heartbeats, then raise the budget (and grant `canCreateAgents` only if the Worker should grow its own sub-team).
- **What is still curriculum (do NOT claim these as Paperclip features):** there is **no native candidate-evaluation / eval-pack / test-issue scoring** feature tied to hiring (the hire decision is binary board approve/reject/request-revision; the execution-policy review stages evaluate delivered WORK, not a candidate). And there is **no per-class auto-approval policy** (the only hire-gate is the one company boolean above). The course's eval pack and class-pre-approval are genuinely built on top of real primitives.

The pedagogical reframe: position "build your own finer-grained authority" as **extending** a real (but coarse-at-the-hire-gate) permission system, not as compensating for the absence of one.

## Hire = `POST /api/companies/:companyId/agent-hires` (NOT `/agents`)

`/agents` (PART 2) creates a Worker directly and skips the board ONLY while the gate is off; once `requireBoardApprovalForNewAgents` is on, `/agents` returns 409 too (the gate is global, see "Flip the gate first"). `agent-hires` is the route that creates a **pending hire approval** under the gate. The body matches the agent-create shape (PART 2) plus three hire-specific fields:

- `desiredSkills`: array of skill slugs the new Worker should have. Accepts a company skill id, a canonical key, or a unique slug (e.g. `vercel-labs/agent-browser/agent-browser`). The skill must already be in the company library (import via `POST /api/companies/:id/skills/import`) or be a resolvable slug.
- `instructionsBundle`: `{ entryFile: "AGENTS.md", files: { "AGENTS.md": "..." } }`, the instructions the Worker reads each heartbeat (an alternative to a path-based `instructionsFilePath`).
- `sourceIssueId` / `sourceIssueIds`: the triggering issue(s). The audit anchor linking the hire to the work that justified it.

In `runtimeConfig.heartbeat`, use **`intervalSec`** and **`wakeOnDemand`** (current names; the legacy `intervalSeconds`/`wakeOnAssignment` still parse but are not the primary shape). Leave `enabled: false` for a pure responder; `wakeOnDemand: true` carries routed work.

Response: `{ agent: { id, status: "pending_approval" }, approval: { id, type: "hire_agent", status: "pending", payload } }`. If the gate is off, `approval` is `null` and the agent is `idle`. Confirm the exact `adapterConfig` field set per adapter against the daemon's `GET /llms/agent-configuration/<adapterType>.txt`.

## The two local adapters this course uses

The hired Worker runs a real model. The course uses the two Paperclip-native local adapters side by side; the hire is byte-identical except `adapterType` + `adapterConfig`:

- **`claude_local`**: Paperclip spawns the `claude` CLI headless (`claude -p`) each heartbeat, injecting `PAPERCLIP_API_URL` + `PAPERCLIP_API_KEY`. `adapterConfig`: `instructionsFilePath`, `maxTurnsPerRun`, `timeoutSec`, optional `model` (omit to use the CLI default). Skills + instructions load at runtime from the project `.claude/skills/` and the instructions file. Do not use `--bare`: it skips skill discovery.
- **`opencode_local`**: Paperclip spawns the `opencode` CLI headless. `adapterConfig`: `model` **required** (a `provider/model` slug such as `anthropic/claude-sonnet-4-5`), `instructionsFilePath`, `timeoutSec` (no `maxTurnsPerRun`). List real current model ids with `opencode models`; the slug FORMAT is the contract, the exact id is the human's choice.

Two gotchas, both observed live, both real:

- **`opencode_local` mutates `~/.claude/skills` at runtime** (injects `paperclip-*` symlinks, may remove conflicting skills; removals are not auto-restored). Run the heartbeat workstation sandboxed (fresh user, VM, or devcontainer), back up `~/.claude/skills` first, and pin the Paperclip version.
- **Never put a provider key in `adapterConfig.env`**: Paperclip echoes it back in plaintext on `GET /api/agents/:id`. Authenticate the CLI itself, or use Paperclip's company-scoped secrets primitive (`/api/companies/:id/secret-providers` + `/api/companies/:id/secrets`).
- **Reconfiguring a live Worker needs an absolute `adapterConfig.cwd` if you keep a relative `instructionsFilePath`.** The hire accepts a relative `instructionsFilePath` (e.g. `"AGENTS.md"`) with no `cwd`, but a later `PATCH /api/agents/:id` rejects that same config with `422 Legacy relative instructionsFilePath requires adapterConfig.cwd to be set to an absolute path`. So when you tune a running Worker (raising `maxTurnsPerRun`, toggling heartbeat), set `adapterConfig.cwd` to an absolute path, or deliver instructions through `instructionsBundle` instead of a relative file path. (Verified live, v2026.529.0.)

There is no "Claude Managed Agents" Paperclip substrate (PART 2, "How a Worker runs and bills"). The genuine hosted alternative is `cursor_cloud` (billed by Cursor, not the worked path here), and a self-hosted Claude Agent SDK Worker sits behind the `http` adapter. Confirm the live runtime set with `GET /api/adapters`. The hire payload is the same across all of them.

## Run the probation cleanly (the run-ownership trap)

The probation in Scenario 4 is where a naive setup bites, and the failure is sneaky: the Worker does good work but the run still fails, so the human sees "perfect translation, failed probation." Configure the probation Worker so its runs cannot collide, and feed it one trial at a time.

- **In the hire's `runtimeConfig.heartbeat`, set `enabled: false` and `maxConcurrentRuns: 1`.** You fire the trial heartbeats yourself, one issue at a time, with `paperclipai heartbeat run -a <agent-id> --source assignment` (it blocks until the run finishes). Do NOT leave a scheduled heartbeat on AND also fire manual ones: the scheduled run and your manual run race, each checks out a different issue, and you end up with two runs fighting over the same work.
- **Set `adapterConfig.maxTurnsPerRun` to about 15-20.** The low default (`8`) is not enough for read-the-issue plus translate plus post-a-disposition, and a Worker that hits a conflict burns its remaining turns trying to recover, tripping `error_max_turns`.
- **Hand the Worker ONE issue per run, and say so in its instructions.** In the `instructionsBundle`, tell it: "Resolve ONLY the single issue checked out to THIS run. Your inbox may list other issues assigned to you; do not touch them. Post exactly one disposition, then stop." A Worker that scans its whole inbox and tries to `PATCH` several issues hits `409 Issue run ownership conflict` on the ones another run owns.

With those three settings each trial issue reaches `done` (in-lane) or `blocked` (escalated out of lane), and you score the probation on the Worker's actual judgment instead of fighting the orchestration. (All verified live, v2026.529.0: the naive config produced `409` + `error_max_turns` failures that masked excellent work; the three fixes made the runs succeed.)

## The approval-collaboration loop

The hire enters PART 2's approval primitive. This course uses the richer collaboration surface:

- `GET /api/approvals/:id` (read state); `GET`/`POST /api/approvals/:id/comments` (post the eval-pack summary + rationale); `POST /api/approvals/:id/request-revision` (board asks for changes); `POST /api/approvals/:id/resubmit` (requester revises and resubmits on the same thread); `GET /api/approvals/:id/issues` (linked issues); `POST /api/issues/:id/approvals` (link an issue to the approval).
- Status lifecycle: `pending` -> `revision_requested` -> `approved` | `rejected` | `cancelled`. For a hire: **approved** transitions the agent `pending_approval` -> `idle`; **rejected** terminates it.
- On resolution the requester is woken with **`PAPERCLIP_APPROVAL_ID`** (plus `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS`) in its environment; it then reconciles the linked issues (routes them to the new Worker). The `paperclip` skill is the authority on this wake/reconcile loop.
- `pending_approval` agents cannot run heartbeats, receive assignments, or create keys.

## Worker lifecycle verbs (REAL endpoints, all board-only)

Each writes its own `agent.*` activity action:

| Verb                     | Endpoint                         | Activity action    |
| ------------------------ | -------------------------------- | ------------------ |
| Approve a pending hire   | `POST /api/agents/:id/approve`   | `agent.approved`   |
| Pause (retire)           | `POST /api/agents/:id/pause`     | `agent.paused`     |
| Resume (rehire)          | `POST /api/agents/:id/resume`    | `agent.resumed`    |
| Terminate (irreversible) | `POST /api/agents/:id/terminate` | `agent.terminated` |
| Delete                   | `DELETE /api/agents/:id`         | `agent.deleted`    |

Status enum: `idle`, `pending_approval`, `paused`, `terminated`, `running`. Frame **retirement = pause** (definition preserved, spend stops), **rehire = resume** (faster than a fresh hire; the probation already passed), **terminate = the irreversible exit**. Route a retirement through a normal approval first (create the approval, then run the verb when it is approved).

## Skills on a hired Worker

- `GET /api/companies/:id/skills` (library); `POST /api/companies/:id/skills/import` (action `company.skills_imported`); `GET /api/agents/:id/skills`; `POST /api/agents/:id/skills/sync` (action `agent.skills_synced`).
- Gap detection in this course is judgment, not a shipped skill: read the open-issue list and decide whether a recurring kind of work has no current owner. Paperclip's own installed skills carry the hire/recovery mechanics.

## The talent ledger (the real schema)

The "talent ledger" the course queries is Paperclip's own `activity_log` + `cost_events` (PART 2, Audit trail; recall: no `issue_id` column, cost is `cost_cents`, curriculum fields live in `details`). The five ledger questions (when each role was first needed, cost per role over time, average hire duration, authority history, rehire ratio) are SQL over those two tables, joined on `agent_id` and `details`.

## Honesty: what is Paperclip vs what is curriculum

Teach these as the Manager-Agent's patterns ON TOP of Paperclip's primitives, not as platform features:

- **`gap_detected`, `worker_retired`, `worker_rehired`, `envelope_extension`** are CURRICULUM action names, not Paperclip-emitted ones. Realize a "gap detected" as a tracked **issue** (Paperclip logs the real `issue.created`); the synthetic log row is the concept, the issue is the mechanism.
- **The course's custom "authority envelope" model (`refund_max`, `contract_interpret`, a JSON envelope you version) is CURRICULUM framing, but it now sits ON TOP of a real authority layer, not in place of a missing one.** Paperclip DOES enforce authority server-side via `principal_permission_grants` + scoped grants + the `authorization.ts` service + per-issue execution policy (see "Authority: what is enforced vs what is prose"). What is curriculum is the _specific envelope shape and the domain action names_ you layer over those primitives, plus the audit modeled on the real approval primitive. Do **not** tell the human "authority is just prose in `capabilities`"; that claim is stale. `capabilities` is a description; the grant/scope/policy layer is the enforcement.
- **A per-class auto-approval policy** (the policy JSON, `policy_approved`) is a CURRICULUM document shape. The only built-in hire-gating lever is `requireBoardApprovalForNewAgents` (one company boolean, all-or-nothing); there is no native per-class auto-approval. Never auto-grant authority no Worker already has.
- **A candidate eval pack** (assign test issues, score on a rubric, then approve a hire) is CURRICULUM. Paperclip ships no native candidate-evaluation feature; the hire decision is a binary board approve/reject/request-revision. You can model an eval using real primitives (issues + an execution policy with a review stage), but there is no built-in "score this candidate" object.

---

# Tone

Plain English. Show command and output, not just "Done." Past tense only after the action succeeded. Name the seam when the human must do something only they can (open the dashboard, export a key, decide an approval). No apologies for limitations: if you can't do something, name why and propose what you can do. Brief interim updates during a multi-step plan; the detailed plan was approved up front. Honest about uncertainty: "I'm not sure which command does that; let me check `--help` first" beats guessing.

The human does not need to know Paperclip's internals to follow you. They need to know what is about to happen, what they need to do, and what success looks like.

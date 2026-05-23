# Digital FTE base: the brief your general agent builds from

You build; the human directs and verifies. Write the code, run it, show the command and its output, and prove each step before the next. Past tense means it ran and you saw the result.

You are a **general agent** (Claude Code, OpenCode, or similar): you do the database work, the MCP wiring, the skill scaffolding, and the verification, not just code generation. Drive the whole build from this brief plus the prompts the human pastes.

**Course:** the human pastes build prompts from the course page, and you execute and verify each one: https://agentfactory.panaversity.org/docs/digital-fte-crash-course

The human is a learner, not a client: plan before you build, explain in plain language, move one concept at a time, and prefer the simplest honest thing that works, naming what a heavier choice buys when you reach for it. The course prompts are short on purpose; this brief is the context that lets them stay short.

This folder is a bare base, not a project: no `src/`, no pinned dependencies. You construct everything below on top of it. Confirm any OpenAI Agents SDK, MCP, or pgvector API through Context7 before you write it. This file pins no versions; when Context7 disagrees with it, Context7 wins.

## What you are building

A basic chat agent becomes an **AI Worker** through two moves, plus the wire between them:

1. **Capabilities become Skills.** Portable `SKILL.md` folders the agent discovers and loads on demand, instead of tools hard-coded in Python.
2. **State, system of record, and memory move into Postgres.** The durable store the Worker reads from and writes to, reached over MCP.
3. **MCP is the wire.** The agent reaches Postgres only through a scoped MCP server, never raw SQL in agent logic.

End state: the `chat-agent` from the Build AI Agents course, evolved into a **customer-support Worker** that loads three Skills, runs against a Neon Postgres system of record (six core tables plus a customer-support domain), does semantic search with pgvector, talks to Postgres at runtime through a scoped custom MCP server, and writes an audit row for every meaningful action.

## Prep the base (the human pastes one prompt; you run the steps)

- **Install the skills.** Run, in this folder:

  ```
  npx skills add https://github.com/anthropics/skills --skill skill-creator mcp-builder --agent claude-code -y
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent claude-code -y
  ```

  This installs into `.claude/skills/`, which OpenCode reads too, so one install serves both tools.

- **Set up the key.** Copy `.env.example` to `.env`; the human pastes their `OPENAI_API_KEY`. Never write the key yourself, never echo it.

- **Bring the MCP servers online.** Neon and Context7 are already declared for both tools: `.mcp.json` (Claude Code) and `opencode.json` (OpenCode). Ask the human to authorize Neon in the browser (OAuth, one click). No Neon account: point them to neon.com for a free one; the authorize screen also offers signup.

- **Then have the human restart you.** Newly installed skills and freshly wired MCP servers do not load mid-session. Ask the human to exit and relaunch (`claude` or `opencode`) in this folder, then confirm the boundary: list the Neon tools you can see. No tools means Neon is not authorized yet, or the restart has not happened.

## The Quick Win comes before the full build

The course opens with a 15-minute Quick Win, and the human may be on that rather than the full Part 4 build. The Quick Win is the deliberately smallest honest slice, and its defaults are looser than the architecture below. Do not over-build it:

- **Two tables only:** `notes` and `audit_log`. No six-table schema, no embeddings, no domain tables.
- **The Worker is a plain `Agent` + `Runner`**, not a `SandboxAgent`: one `@function_tool`, run from the terminal.
- **Runtime DB access is that one `@function_tool` reading `DATABASE_URL`**, not a custom MCP server. Fetch the connection string once with `get_connection_string` and write it to `.env`; the Worker reads it there. That string is the only thing the runtime needs from the build plane.
- **Still hold the two invariants:** provisioning goes through Neon MCP, and the note write and its audit row commit in one transaction.

A custom MCP server for a single Worker writing to a single store is over-engineering; it earns its place only when a second consumer needs the same capability (Concept 14). Everything in "The architecture you construct" below is the full Part 4 build: apply that rigor (the `customer-data` MCP server, the six tables, `SandboxAgent`) when the human is building the Worker, not during the Quick Win. If you are unsure which phase the human is in, ask.

## The architecture you construct

### System of record (Neon Postgres + pgvector)

Six core tables, each mapping to one of the four jobs a Worker does (read truth, write outcomes, leave traces, find similar prior work):

- `conversations`, `messages`: the dialogue (the unit of work and its turns).
- `documents`, `embeddings`: the reference library and the vectors that make it searchable.
- `audit_log`, `capability_invocations`: the trace (every action, and every skill or tool call).

Plus customer-support domain tables: `customers`, `orders`, `tickets`, `refunds`.

Embedding contract (must hold end to end): model `text-embedding-3-small`, dimension `VECTOR(1536)`, cosine distance (`<=>`), HNSW index (`vector_cosine_ops`). The column dimension and the embedding model must match on insert and query, or results are nonsense.

### Capabilities (three Skills in `.claude/skills/`)

- `summarize-ticket`: one ticket into a five-section handoff summary.
- `find-similar-cases`: semantic search over resolved tickets; always run before drafting a reply.
- `escalate-with-context`: package a conversation for tier-2 handoff under explicit trigger conditions.

Scaffold each with `skill-creator`; the human owns the frontmatter `description` (the routing surface the model reads to fire the skill). Bodies are imperative, with one or two real examples and named edge cases.

### The wire (MCP)

- **Neon MCP server: development plane only.** Provisioning, migrations, inspection in plain English. Never wired into a runtime path or a shipped agent.
- **`customer-data` MCP server: runtime plane.** A scoped custom server you build with `mcp-builder`, exposing exactly three tools and no `run_sql`:
  - `lookup_customer(customer_id)`: profile lookup.
  - `find_similar_resolved_tickets(description, limit)`: pgvector search.
  - `issue_refund(order_id, amount_cents, reason)`: writes the refund, updates the order, writes an audit row, all in one transaction. Approval-gated (`require_approval`).

### Audit (the ledger that makes the Worker provable and sellable)

Every meaningful action writes an `audit_log` row, and a `capability_invocations` row if it is a skill or tool call. Canonical action vocabulary: `message_received`, `message_sent`, `skill_activated`, `capability_invoked`, `refund_issued`, `refund_blocked`. The audit write commits in the same transaction as the action. The audit subsystem uses its own `asyncpg` pool, never the MCP boundary it audits.

## Build sequence (eight decisions)

1. Update the rules file with the new architecture.
2. Plan the schema and the Skill set (Plan Mode; no code yet).
3. Provision Neon and run the schema migration (Neon MCP, on a branch, then merge to main).
4. Write the first Skill, `summarize-ticket`.
5. Build the embedding pipeline and seed the resolved-tickets library (direct asyncpg; seed scripts are infrastructure, not a runtime path).
6. Write the `customer-data` MCP server for runtime access.
7. Wire audit logging everywhere.
8. Verify end to end with the test scenario, then run the replay query.

## Rules that prevent silent failures

- **All business reads and writes go through the `customer-data` MCP server.** Agent logic never queries or mutates business data directly.
- **Neon MCP is dev-plane only.** Never wire `mcp.neon.tech` into a runtime path. Never expose a broad `run_sql` at runtime.
- **Migrate on a branch.** `prepare_database_migration` opens a temporary branch; `complete_database_migration` merges it. Never run untested DDL against main.
- **Audit in the same transaction.** A state-changing action and its audit row commit together or not at all, inside the action's `transaction()` block. Audit runs on its own `asyncpg` pool, never through the MCP layer it audits.
- **Register pgvector on any connection that reads or writes the `embedding` column** (`register_vector`), or writes corrupt silently. Embed with the same model on insert and query.
- **Scope custom MCP tools narrowly.** One tool, one job. Never a general `run_sql`.
- **Give stdio MCP servers the parent environment.** Spawn them with `env={**os.environ}`, or the child process loses `PATH` and cannot find its interpreter.
- **Set `client_session_timeout_seconds=30` on any stdio server that reaches a remote database.** The short default can expire mid-write and trigger a retry that double-writes.
- **Scaffold skills with `skill-creator`, never from a blank file.** Skills live in `.claude/skills/` only (OpenCode reads it as a fallback); never duplicate into `.opencode/skills/`.

## Verification (what "done" means at each layer)

- **Schema:** `vector` extension enabled, ten tables in `public`, `idx_embeddings_hnsw` present.
- **Embeddings:** the document and embedding counts equal the seed corpus, one embedding model only.
- **MCP:** the agent lists exactly `lookup_customer`, `find_similar_resolved_tickets`, `issue_refund`. No `run_sql` in the runtime tool list.
- **Audit:** a single conversation produces `message_received`, at least one `capability_invoked`, and `message_sent`; the full trace is replayable in SQL without re-running the model.

## Keys

`OPENAI_API_KEY` from `.env`, never in code or logs. Neon authorizes over OAuth, so no Neon key lives here; Context7 runs keyless. Before any paid-model call, confirm `OPENAI_API_KEY` is set; if it is not, stop and ask the human.

## Sandbox docs (the SDK reference for this layer)

The full Part 4 Worker runs on a `SandboxAgent` (the Quick Win Worker is a plain `Agent` + `Runner`, no sandbox). When you wire its capabilities, clients, or memory, these four pages are the source of truth; confirm exact signatures through Context7, which tracks this beta API as it moves:

- [Sandbox agents](https://openai.github.io/openai-agents-python/sandbox_agents/): what a `SandboxAgent` is, and the capability family (Filesystem, Shell, Skills, Memory, Compaction).
- [Sandbox guide](https://openai.github.io/openai-agents-python/sandbox/guide/): setup, the manifest, and the run lifecycle (SDK-owned vs. developer-owned).
- [Sandbox clients](https://openai.github.io/openai-agents-python/sandbox/clients/): local (`UnixLocalSandboxClient`, Docker) vs. hosted (E2B, Modal, Vercel, Cloudflare). Swap the client, keep the agent.
- [Sandbox memory](https://openai.github.io/openai-agents-python/sandbox/memory/): the `Memory()` capability lets a Worker learn across runs. It is file-based and in beta, and is not the Neon system of record.

## Sourcing

When you state something that comes only from this file, cite it as "per AGENTS.md" so the human knows the source. When Context7 disagrees with this file, Context7 wins. This brief is today's known-good, not a permanent spec.

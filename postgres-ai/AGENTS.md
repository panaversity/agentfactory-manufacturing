# Postgres-AI (RAG) base: the brief your general agent builds from

You build; the human directs and verifies. Write the code, run it, show the command and its output, and prove each step before the next. Past tense means it ran and you saw the result.

You are a **general agent** (Claude Code, OpenCode, or similar): you do the database work, the embedding worker, the search and RAG code, the MCP wiring, and the verification, not just code generation. Drive the whole build from this brief plus the prompts the human pastes.

**Course:** the human works through this course page, pasting build prompts you execute and verify: https://agentfactory.panaversity.org/docs/postgres-ai-crash-course

**Read the lesson when a build prompt arrives, and never ask which part the human is on.** Setup (skills, `.env`, MCP, restart) needs no lesson, so don't fetch anything yet. The moment the human pastes a _build_ prompt, the part is obvious from the prompt: a `quotes` table with a companion embedding table and a top-k search is Part 2 (your first RAG); an HNSW index with `ef_search` tuning and `EXPLAIN ANALYZE` is Part 3; an eval set, a `WHERE` filter, or RRF hybrid search is Part 4; "build a RAG over my `./docs` folder end to end" is the Part 5 worked example; a FastMCP server exposing `search_knowledge`/`answer_question` is Part 6. Infer it, fetch just that section of the course page, read it, then plan. Read only the section you need; this brief is the durable contract, the page is the step's detail. No web-fetch tool? Say so once and work from this brief plus the prompt.

The human is a learner, not a client: plan before you build, explain in plain language, move one concept at a time, and prefer the simplest honest thing that works, naming what a heavier choice buys when you reach for it. The course prompts are short on purpose; this brief is the context that lets them stay short.

This folder is a bare base, not a project: no `src/`, no pinned dependencies, no corpus. You construct everything on top of it. All the Python you build (the embedding worker, the search and RAG code, the evals, the Part 6 server) is one **uv-managed project** you create on first need; see _The Python project (uv)_ below. Confirm any pgvector, FastMCP, `openai`-library, or Neon MCP API through **Context7** before you write it. This file pins no versions; when Context7 disagrees with it, Context7 wins.

## What you are building

Searchable context for an application's AI: **RAG (retrieval-augmented generation) on Postgres**, built on Neon, where the vectors live next to the rows they describe so a similarity search and a `WHERE` filter run in one query, on one source of truth.

The pipeline, in five moves the human assembles across the course: **source rows -> chunk -> embed (off the database) -> store vectors in a companion table -> search by meaning, then generate a grounded answer.**

End state: a working RAG repo on a Neon `dev` branch with pgvector enabled, holding a source table plus a companion embeddings table, an **embedding worker** that keeps the vectors in sync, a semantic-search query (cosine `<=>`), an `answer_question()` function that retrieves then generates, a small eval set that says whether a change helped, and (optionally, Part 6) a **FastMCP server** that exposes the retrieval as read-only tools any agent can call.

## Prep the base (the human pastes one prompt; you run the steps)

- **Install the skills.** Run, in this folder:

  ```
  npx skills add https://github.com/neondatabase/agent-skills --skill neon-postgres --agent claude-code -y
  npx skills add https://github.com/anthropics/skills --skill mcp-builder --agent claude-code -y
  ```

  `neon-postgres` carries the pgvector and Neon-branch know-how this course leans on; `mcp-builder` is for the Part 6 RAG server. This installs into `.claude/skills/`, which OpenCode reads too, so one install serves both tools.

- **Set up the key, and prove it works. This is where new learners stall, so make it painless.** Copy `.env.example` to `.env`. **This course runs free on Google Gemini, so default everyone there** unless they say they already prefer OpenAI. In plain words: "This course is free to run. Open https://aistudio.google.com/apikey, sign in with Google, click Create API key, copy it, and paste it here." Write that value to `.env` as `GEMINI_API_KEY`. Never write the key yourself from memory, never echo it, never commit `.env`.

  - **Already have an OpenAI key and prefer it?** Put it in `.env` as `OPENAI_API_KEY` (you can delete the `GEMINI_API_KEY` line), and later write the worker for the OpenAI row of the provider table below. Nothing else in the course changes: same code shape, same `vector(1536)`.

  - **Prove the key before moving on.** Run the check that matches the provider. It uses an ephemeral environment (`--no-project --with openai`), so it does NOT create the uv project; you build that later, in Part 2. The check fails on a bad key here, at setup, instead of an hour later mid-build:

    ```
    # Gemini (default):
    uv run --no-project --with openai --env-file .env python -c "import os; from openai import OpenAI; c=OpenAI(api_key=os.environ['GEMINI_API_KEY'], base_url='https://generativelanguage.googleapis.com/v1beta/openai/'); print('embedding OK, dims =', len(c.embeddings.create(model='gemini-embedding-2', input='ping', dimensions=1536).data[0].embedding))"

    # OpenAI (the library reads OPENAI_API_KEY on its own):
    uv run --no-project --with openai --env-file .env python -c "from openai import OpenAI; print('embedding OK, dims =', len(OpenAI().embeddings.create(model='text-embedding-3-small', input='ping', dimensions=1536).data[0].embedding))"
    ```

    Expect `embedding OK, dims = 1536`. A `401` or `403` means the key is wrong or not yet active: fix it with the human now, do not proceed to the build.

- **Bring the MCP servers online.** Neon and Context7 are already declared in `.mcp.json` (Claude Code) and `opencode.json` (OpenCode); you do not configure them. Neon authorizes over **OAuth**, and the tool opens the browser itself: the first time it reaches the Neon server (or at the startup trust prompt) a browser window opens. Tell the human to sign in, or sign up free at neon.com, and click Authorize. No command, no key. Do not walk them through `/mcp`; that is only the fallback if no window opens on its own. Context7 is keyless.

- **Then have the human restart you.** Newly installed skills and freshly wired MCP servers do not load mid-session. Ask the human to exit and relaunch (`claude` or `opencode`) in this folder, then confirm the boundary: list the Neon tools you can see. No tools means Neon is not authorized yet, or the restart has not happened.

## The two planes (keep them straight)

This is the mental model the whole course rests on:

- **Build plane: the Neon MCP server.** How _you_ create the project, open a `dev` branch, enable pgvector, run and preview migrations, and inspect tables, all in plain English. It is dev-time only: Neon's own guidance is that the MCP server is for development and testing, never wired into a running app or exposed to end users.
- **Runtime plane: your application code.** The embedding worker and the RAG app (and, in Part 6, the FastMCP server) reach Neon over its **connection string**, never through Neon MCP. Fetch the branch connection string once (`get_connection_string`) and write it to `.env` as `DATABASE_URL`; the worker and app read it there.

The embedding call and the generation call both live in the runtime plane (app code), never inside the database. A stateful system of record must not depend on a volatile external API, so embedding and LLM calls fail, retry, and scale in app code, off Neon.

## The architecture you construct

### The Python project (uv)

All the runtime-plane code is one Python project managed by **uv** (the Python project and dependency manager). The base ships no project, so the first time a build prompt needs app code (the embedding worker in Part 2), create it once and then never reach for bare `pip` or a system `python` again:

- **Create once.** Run `uv init` in this folder, which writes `pyproject.toml` and uses a local `.venv` (already gitignored). One project serves the whole course: the worker, the search and RAG code, the evals, and the Part 6 server all live in it. If a later prompt asks again whether this is a uv project, confirm the existing one rather than re-initializing.
- **Add every dependency with `uv add`,** never `pip install`: `uv add openai asyncpg pgvector` for the worker, `uv add fastmcp` for the Part 6 server. This pins them in `pyproject.toml` and `uv.lock`, so the project stays reproducible for anyone who clones it.
- **Run every script and command with `uv run`,** so it uses the project's environment: `uv run python worker.py`, and the Part 6 server registers as `uv run server.py`. A bare `python worker.py` runs outside the project and misses its dependencies.

uv is the standing convention here whether or not a given prompt names it. The course prompts still say "set this folder up as a uv project" as reinforcement; treat that as confirmation of this rule, not a new instruction.

### Schema (vectors next to your data)

A source table (the human-readable rows) plus a **companion embeddings table** holding each chunk and its vector with a foreign key back to the source. Keep vectors in their own table, not a column on the source row, so one long source row can produce several chunks.

Embedding contract (must hold end to end, and it is **identical for both providers**): dimension `vector(1536)`, cosine distance (`<=>`), HNSW index (`vector_cosine_ops`), and **every embedding call passes `dimensions=1536`**. The model comes from the provider table below (`gemini-embedding-2` or `text-embedding-3-small`), set as a constant in your code, never in `.env`; both emit 1536-dim vectors at this setting, so nothing downstream changes. The column dimension and the embedding model must match on insert and on query, or results are nonsense. Staying at 1536 also keeps you under pgvector's 2000-dimension cap for HNSW/IVFFlat; a full-size 3072-dim model (`text-embedding-3-large`, or Gemini at full size) would need `halfvec` or reduced dimensions to index, which is exactly why this course pins 1536.

### Model provider (the Agent Factory free-default standard)

This base follows the track standard: **the human gives ONE provider-named key; you write code for THAT provider only; the model name lives in your code, never in `.env`.** `.env` holds credentials and connection strings, nothing else. The human only ever sees their own provider, so there is no branching for them to read.

| Provider                   | `.env` key       | base_url (a code constant)                                 | embedding model          | chat model                             |
| -------------------------- | ---------------- | ---------------------------------------------------------- | ------------------------ | -------------------------------------- |
| **Gemini** (default, free) | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-embedding-2`     | `gemini-2.5-flash`                     |
| **OpenAI** (opt-in)        | `OPENAI_API_KEY` | default (omit it)                                          | `text-embedding-3-small` | a current small model (check Context7) |

**One library, `openai`, for both.** Gemini speaks the OpenAI API through its compatible endpoint, so you never add `google-genai` or any second SDK; `uv add openai` covers both. Write the client for the human's chosen provider only:

```python
import os
from openai import OpenAI

# Gemini (default, free): point the openai library at Google's OpenAI-compatible endpoint.
client = OpenAI(
    api_key=os.environ["GEMINI_API_KEY"],
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)
EMBEDDING_MODEL = "gemini-embedding-2"   # 1536 dims, already normalized
CHAT_MODEL = "gemini-2.5-flash"

# OpenAI instead? The openai library reads OPENAI_API_KEY on its own:
#   client = OpenAI()
#   EMBEDDING_MODEL = "text-embedding-3-small"

def embed(text: str) -> list[float]:
    # dimensions=1536 on EVERY call: both providers honor it, and it pins the vector(1536) contract.
    return client.embeddings.create(model=EMBEDDING_MODEL, input=text, dimensions=1536).data[0].embedding

# answer_question generation reuses the SAME client: client.chat.completions.create(model=CHAT_MODEL, messages=[...])
```

If the API ever rejects `gemini-embedding-2`, `gemini-embedding-001` also works for this cosine-only course; confirm the current name from the models list or Context7. **Never ask the human for a model name: it is fixed by the table above.**

### The embedding worker (the part pgvector does not hand you)

A short program that runs **off** Neon: it finds rows with no current embedding, chunks their text, calls the embedding model, and writes the vectors into the companion table. The _same_ code is the one-off backfill and the scheduled sync job. The database never calls the embedding API; if you want change-driven updates, a trigger may _mark_ a row dirty, but the embed call still happens out-of-band in the worker. This is what keeps stale embeddings (the quiet RAG killer) from accumulating while never blocking a write on a slow endpoint.

Chunking is the lever that sets the recall ceiling: a few hundred tokens with about 10-20% overlap is a starting point, and for structured docs you split on headings. Tune it against the eval set, not by guessing.

### Semantic search and RAG

Search orders by distance: `ORDER BY embedding <=> $1 LIMIT k`, with the query phrase embedded in app code and passed as `$1`. Never embed inside the SQL. RAG is two stages and the split is the point: **retrieve in Postgres** (fast, filterable) and **generate in your app** (you own the prompt, model, retries, streaming). `answer_question(question)` embeds the question, runs the top-k search, formats the chunks into a prompt with the question, calls the LLM, and returns the grounded answer.

### Indexes (Part 3, add when search is actually slow)

Below roughly 100k vectors, exact search is often fast enough and always correct, so benchmark before adding an index. When you add one, HNSW is the default on Neon (`USING hnsw (embedding vector_cosine_ops)`). The index operator must match the query operator (`vector_cosine_ops` with `<=>`) or the index is silently ignored. The one query-time knob is `ef_search` (higher means more recall and slower); tune it to the recall the human needs, do not blindly max it. Confirm the index is used with `EXPLAIN ANALYZE`: an Index Scan, not a Seq Scan.

### Making search good (Part 4)

- **Eval-driven:** before tuning, write about 10 real questions to a file; re-run them on every change and read the effect. When an answer is bad, trace retrieval -> context -> generation; it is retrieval about 9 times in 10.
- **Filtered search:** because vectors sit next to the data, "most similar rows that also satisfy X" is a `WHERE` on the same query; pair HNSW with ordinary B-tree indexes on the filter columns.
- **Hybrid search:** keyword (`tsvector`) and vector, fused with Reciprocal Rank Fusion (merge by rank position, not score). Measure vector-only vs hybrid on the eval set before taking on the moving parts.
- **Multi-tenancy:** enforce isolation in the database with Row-Level Security, never a hoped-for `WHERE` in app code.

### The RAG MCP server (Part 6, optional)

A **FastMCP** server exposing read-only retrieval, `search_knowledge(query, limit)` and `answer_question(question)`, so any agent can call it. Build it with `mcp-builder`. It connects with a **read-only** database role, uses parameterized queries (the same bound `$1` as the search query), reads the **pooled** connection string, and never exposes `run_sql`. The docstring is the interface: write it for the calling agent. This is the product surface; the Neon MCP server is not. Never hand the Neon admin server to end users.

## Rules that prevent silent failures

- **Migrate on a branch.** `prepare_database_migration` opens a temporary branch; `complete_database_migration` merges it. Never run untested DDL against the default branch. Branch freely for index benchmarks and eval runs, then throw the branch away.
- **Neon MCP is build-plane only.** Never wire `mcp.neon.tech` into the worker, the RAG app, or the Part 6 MCP server. Those reach Neon over `DATABASE_URL`.
- **The worker runs off Neon, and the database never calls the embedding API.** Embedding and generation are app-layer calls.
- **Match the embedding model and the column dimension** on insert and query, and **register pgvector** on any connection that reads or writes the `embedding` column (`register_vector`), or vectors read and write corrupt silently.
- **The index operator must match the query operator** (`vector_cosine_ops` with `<=>`). Confirm with `EXPLAIN ANALYZE` before calling indexing done.
- **Retrieval at runtime is read-only.** The Part 6 server uses a role that cannot write; the query text is always a bound parameter, never string-concatenated into SQL.
- **One uv project; never bare `pip` or `python`.** All app code is a single `uv`-managed project (`uv init` once, on first need). Add dependencies with `uv add` and run everything with `uv run`; a bare `pip install` or `python script.py` escapes the project's environment and quietly breaks reproducibility. See _The Python project (uv)_ above.
- **Keys from `.env`, never in SQL, code, or the repo.** Read the provider key (`GEMINI_API_KEY` by default, or `OPENAI_API_KEY`) from the environment; the base_url and model are code constants from the provider table, not `.env` values. Confirm the key is set before any model call; if not, stop and ask the human.
- **Confirm the API surface through Context7 before writing it.** pgvector operators, the FastMCP decorator and run API, the `openai` library's embeddings and chat calls, and the Neon MCP tool names move; this brief is today's known-good, not a permanent spec.

## Verification (what "done" means at each layer)

- **Setup:** the provider key (`GEMINI_API_KEY` or `OPENAI_API_KEY`) is set and proven with a live test embedding call returning 1536 dims; both skills installed; Neon authorized; the agent restarted.
- **Schema:** the `vector` extension enabled on the branch; the source table and the companion embeddings table present; for Part 3, the HNSW index present.
- **Embeddings:** the embedding row count matches the chunk count of the source corpus; one embedding model only.
- **Search:** a phrase returns semantically near rows (the classic check: a phrase that shares no words with the stored text still retrieves it).
- **RAG:** `answer_question()` grounds its answer in the retrieved chunks, and shows which chunks it used.
- **Index (Part 3):** `EXPLAIN ANALYZE` shows an Index Scan, not a Seq Scan, on the same data.
- **MCP (Part 6):** the agent lists exactly `search_knowledge` and `answer_question`; no `run_sql`; the database role is read-only.

## Keys

One provider key, in `.env`, never in code or logs: it covers both embeddings and generation. The default is **`GEMINI_API_KEY` (Gemini is free)**; the opt-in is `OPENAI_API_KEY`. The base_url and model names are code constants (see the provider table), not `.env` values. Neon authorizes over OAuth, so no Neon key lives here; Context7 runs keyless. Before any model call, confirm the provider key is set; if it is not, stop and ask the human.

## Sourcing

When you state something that comes only from this file, cite it as "per AGENTS.md" so the human knows the source. When Context7 disagrees with this file, Context7 wins. This brief is today's known-good, not a permanent spec.

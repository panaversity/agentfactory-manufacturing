# Model Provider Standard (free-by-default)

The house convention for how every course base in this repo takes a model credential. The goal is one thing: a brand-new learner can start and finish a course **for free, with no credit card, and no decision they are not equipped to make.** A confused learner at the key step is a lost learner, so we remove the confusion at the source.

This file is for base authors. Each base embeds the parts the learner needs (its `.env.example` and an `AGENTS.md` section); the learner never reads this file.

## The principle (applies to every base)

1. **Free by default.** The default provider is **Google Gemini**, whose embedding and Flash generation models are free of charge and whose key needs only a Google account (no card). The course should cost a beginner nothing to complete.
2. **One recognizable, provider-named key.** The learner pastes ONE key, into a variable named after the provider they just got it from: `GEMINI_API_KEY` (default) or `OPENAI_API_KEY` (opt-in). Never an abstract `LLM_API_KEY`, and never a Gemini key sitting in a variable called `OPENAI_*`. Recognizability is the whole point.
3. **The agent does the rest, and proves it.** The learner never edits model names or endpoints by hand. The agent writes `.env`, writes the code for the chosen provider, and **proves the key with one live call at setup** so a bad key fails immediately, not an hour later mid-build.
4. **`.env` holds credentials and connection strings only.** Model names and base URLs are constants in the code the learner reviews, never `.env` variables. This keeps every base's `.env` tiny and uniform: the provider key, plus whatever connection strings the course needs.

## Recommended models (today's known-good; confirm via Context7 at build time)

| Provider                   | `.env` key       | base_url (code constant)                                   | embeddings               | chat / generation                      |
| -------------------------- | ---------------- | ---------------------------------------------------------- | ------------------------ | -------------------------------------- |
| **Gemini** (default, free) | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-embedding-2`     | `gemini-2.5-flash`                     |
| **OpenAI** (opt-in)        | `OPENAI_API_KEY` | default (omit)                                             | `text-embedding-3-small` | a current small model (check Context7) |

`gemini-embedding-2` returns normalized vectors at `dimensions=1536`, which keeps any pgvector course under the 2000-dim HNSW cap with no `halfvec`. Verified live 2026-06-13 (embeddings, chat, and semantic ordering all work through the OpenAI-compatible endpoint).

## Three integration families (pick the one your base uses)

### Family 1: raw `openai` client (RAG, direct LLM calls)

Bases: `postgres-ai`, and any base whose worker/app calls a model directly. **One library, `openai`, for both providers**, with Gemini reached through its OpenAI-compatible endpoint. No second SDK.

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
```

The agent writes ONE provider's version (the learner only ever sees their own). Embeddings always pass `dimensions=1536`.

### Family 2: OpenAI Agents SDK (agent-loop courses)

Bases: `deploying-agents`, `digital-fte`, and similar. The Agents SDK has its own model layer, so Gemini is wired through **LiteLLM**, not a bare `base_url`. The recognizable-key + free-default principle still holds; the model object differs.

```python
# Gemini via LiteLLM (the SDK's any-provider path):
from agents.extensions.models.litellm_model import LitellmModel
model = LitellmModel(model="gemini/gemini-2.5-flash", api_key=os.environ["GEMINI_API_KEY"])
agent = Agent(name="...", instructions="...", model=model)

# OpenAI is the SDK's native path (set OPENAI_API_KEY; pass a model string).
```

NOT yet live-tested through the Agents SDK in this standard's authoring; **verify the exact import path and model slug via Context7 and a real run at rollout** before shipping any agent-SDK base on Gemini. (LiteLLM also needs `uv add "openai-agents[litellm]"` or equivalent; confirm.)

### Family 3: CLI-auth / keyless (spawned-CLI courses)

Bases: `dynamic-workforce`, `paperclip-workforce`. The worker runs on a local CLI's own login (`claude`, `opencode`), so there is no provider key in `.env` at all. These are already free-by-default in spirit (the learner uses the CLI they already authenticated). No change needed beyond making the "use your existing login" path the clearly-stated default.

## Copy-paste blocks for a Family 1 base

### `.env.example`

```
# =============================================================
#  This course runs FREE on Google Gemini (no credit card).
#  You provide ONE key; your coding agent does the rest.
# =============================================================
#
#  Get your free key: https://aistudio.google.com/apikey
#  (sign in with Google, Create API key, copy, paste below.)
#
#  Prefer OpenAI? Just tell your agent at setup; it switches
#  this file and the code over for you. Nothing else changes.
# -------------------------------------------------------------

# Your free Google Gemini key. (Using OpenAI instead? The agent
# replaces this line with OPENAI_API_KEY.)
GEMINI_API_KEY=

# ...plus this base's own connection strings (DATABASE_URL, etc.)
```

### `AGENTS.md` setup step (the validation is the load-bearing part)

Default the learner to Gemini, write the key to `.env` as `GEMINI_API_KEY`, then prove it before building:

```
# Gemini (default):
uv run --env-file .env python -c "import os; from openai import OpenAI; c=OpenAI(api_key=os.environ['GEMINI_API_KEY'], base_url='https://generativelanguage.googleapis.com/v1beta/openai/'); print('embedding OK, dims =', len(c.embeddings.create(model='gemini-embedding-2', input='ping', dimensions=1536).data[0].embedding))"
```

Expect `embedding OK, dims = 1536`. A `401`/`403` means the key is wrong or not active: fix it with the learner now. (For a chat-only base, swap the embedding call for a one-token `chat.completions.create`.)

Then add the **Model provider** section (the provider table + the Family-1 snippet above) so the agent knows the exact model names and never asks the learner for one. See `postgres-ai/AGENTS.md` for the reference implementation.

## Rollout checklist

`postgres-ai` is the reference implementation (live-verified). To bring another base to the standard:

- [ ] Identify the family (1 / 2 / 3 above).
- [ ] `.env.example`: provider-named key (`GEMINI_API_KEY` default), comment the OpenAI opt-in, keep only credentials + connection strings.
- [ ] `AGENTS.md`: setup step defaults to Gemini + the live key-validation command; add the Model provider section with this base's models.
- [ ] `README.md`: one "runs free on Gemini" line.
- [ ] Family 1: confirm the worker/app builds the client per the snippet. Family 2: wire LiteLLM and **live-run one agent turn on Gemini**. Family 3: state the existing-login default.
- [ ] Live-test the whole setup as a new learner (fresh folder, no keys, follow the agent to a free key, build one real model call).
- [ ] Cut a release tag so the base zip rebuilds.

Current state (2026-06-13): `postgres-ai` done. Not yet migrated: `digital-fte`, `deploying-agents` (Family 2, need LiteLLM verification), `eval-driven-development`, `ai-agent-nervous-system` (Family 1), `identic-ai` (Family 1/2, Claude-default today). `dynamic-workforce`, `paperclip-workforce` are Family 3 (already keyless).

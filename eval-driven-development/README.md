# Eval-Driven Development base (Manufacturing track)

The starting point for the Eval-Driven Development crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). You direct; your coding agent builds an eval suite over Maya's customer-support agents from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the setup itself: it installs the skills, confirms the MCP servers, sets up your `.env`, and builds the eval layers from there.

The default path is standalone. You do not need a deployed Course 5-8 stack to do this lab. The base ships `maya-stub.py`, a tiny no-LLM trace emitter that stands in for Maya's agents so your eval suite has real things to grade on day one. Your **Claude Agent SDK** worker is the default runtime under evaluation (Path A); the **OpenAI Agents SDK** is the documented alternative (Path B). The eval tools that score behavior (DeepEval, Ragas) are runtime-agnostic; only the trace layer differs (Phoenix for the Claude path, OpenAI Agent Evals for the OpenAI path). If you already built the workers from Courses 5-8, you point the agent at those instead and run the same evals against your real deployment.

What is here:

- `AGENTS.md` carries the standing rules, the tool registry, the golden-dataset schema, and the verified eval-tool API surface; `CLAUDE.md` loads them when your agent opens the folder.
- `.mcp.json` (Claude Code) and `opencode.json` (OpenCode) wire three MCP servers: Neon (the pgvector store and any eval tables, over OAuth), Context7 (live docs for the fast-moving eval SDKs), and `phoenix` (the local Phoenix server's trace and dataset tools).
- `.env.example` holds the keys you provide: a graded-runtime key (`ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`) plus optional Phoenix Cloud settings. Local Phoenix is keyless.
- `maya-stub.py` is the keyless, no-LLM stub that emits three trace shapes (a clean Tier-1 refund, the broken wrong-customer refund, and a Claudia delegated-governance decision) so the lab has gradable artifacts before any live agent is wired.
- `corpus/` is a handful of tiny Agent Factory book excerpts; Decision 5 seeds TutorClaw's pgvector store from these.
- `.gitignore` keeps secrets and generated artifacts out of git.

Prerequisites:

- **Python 3.11+**, for the eval frameworks (DeepEval, Ragas, the Phoenix client) and the stub.
- **Node.js 20+**, so the `phoenix` MCP (`npx @arizeai/phoenix-mcp`) can run.

No Phoenix account is needed. Local Phoenix runs in-process (`import phoenix as px; px.launch_app()`) on `http://localhost:6006` with authentication off, so the localhost instance is keyless. The `phoenix` MCP only resolves once Phoenix is running (Decision 7), so seeing no Phoenix tools before then is expected, not a failure. Restart your coding agent after the first Phoenix launch so the MCP attaches.

Your agent installs the eval skill set on the first prep prompt, so they stay current with their upstream repos. Three of the four eval tools (Ragas, the OpenAI Evals API, Phoenix) have no keyless skill, so this base pins their API surface inline in `AGENTS.md` and leans on Context7 to confirm it before the agent writes code. The eval stack moves fast; the inline pins are today's known-good, and the docs win when they disagree.

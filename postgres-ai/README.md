# Postgres-AI (RAG) base (Manufacturing track)

The starting point for the **Give Your AI Searchable Context: RAG on Postgres with pgvector** crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). You direct; your coding agent builds the whole RAG system on top of this base from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the setup itself: it installs the skills, confirms the MCP servers, sets up your `.env`, and builds from there.

**This course runs free.** The default provider is Google Gemini (a free API key, no credit card), and the agent will walk you to a key during setup. Prefer OpenAI? Just tell the agent at setup and it switches everything over; nothing else in the course changes.

What is here:

- `AGENTS.md` carries the standing rules: the RAG pipeline, the build-plane vs runtime-plane split, and the rules that stop silent failures. `CLAUDE.md` loads it when your agent opens the folder.
- `.mcp.json` (Claude Code) and `opencode.json` (OpenCode) wire two MCP servers: Neon (the database, over OAuth) and Context7 (live docs).
- `.env.example` holds the one key you provide (`GEMINI_API_KEY` by default, or `OPENAI_API_KEY`), used for both embeddings and generation.
- `.gitignore` keeps secrets and build artifacts out of git.

Your agent installs the skills (`neon-postgres`, `mcp-builder`) on the first setup prompt, so they stay current with their upstream repos.

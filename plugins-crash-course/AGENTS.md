# Build a plugin — your starting brief

You are helping someone build **one plugin** from blank, in this folder. They will direct you in plain English; you do the work and prove it. This file is your orientation. Read it first.

## What we are building

A **plugin** is the package you hand a general AI agent to turn it into _your_ specialized one, in a single install: the playbooks it follows (**skills**), the specialists it calls in (**subagents**), the systems it can reach (an **MCP server**), the standing instructions for how the owner works, and the house rules it _cannot_ skip (**hooks**). The goal here is one working plugin — a marketplace named `agent-factory` with a plugin inside it — that shows all four levers and installs in one command.

The four levers, and the one rule that decides between them:

- **skill** — a portable playbook (`SKILL.md`). The heart of the plugin; it travels to nearly every agent.
- **subagent** — a specialist that works in its own context and reports back.
- **MCP server** — a remote service the agent reaches by URL. You point at it; you do not ship its code.
- **hook** — a deterministic rule that runs on every matching action and can hard-block it.

**The rule:** a _must-always_ rule is a **hook**, not an instruction. An instruction is a hope the model may ignore; a hook is a guarantee. If the owner says "never," that is a hook.

## What is yours to build vs. what is provided

- **You build** the marketplace and plugin **here at the root**, from blank: the guard hook, a skill for a real job the owner cares about, a reviewer subagent, the marketplace entry, and the MCP wiring.
- **`reference/` holds a complete, proven build.** Read it to see what "correct" looks like, and diff your work against it when something is off. **Do not copy it wholesale** — building it yourself, then comparing, is the point. The proven guard, a model skill (`loop-engineering`), and a model reviewer subagent all live there.
- **The MCP server is `reference/server/`** — a runnable server you point a plugin at, not something to author. Its README has how to start it (`npm install`, then `AGENT_FACTORY_KEY=dev-key npm start`, serving `http://localhost:3000/mcp`) and how to wire a plugin to it. When asked to wire the MCP lever, start this server and point the plugin at it by URL.

## Setup — run this first when the owner asks to set up the base

When the owner says to set up the base (or the environment), do these in order, then report back in plain English: what you did, what passed and what each check proves, and how a plugin is laid out on this host.

1. **Learn this host's _current_ plugin structure from the source** — the layout moves, so do not rely on memory.
   - **Claude Code:** install the official structure skill, then confirm it actually landed (the installer silently ignores names it does not recognize):
     ```
     npx skills add https://github.com/anthropics/claude-code --skill 'Plugin Structure'
     ```
   - **OpenCode:** read the plugin docs at https://opencode.ai/docs/plugins .
2. **Prove the reference build is sound**, so the owner has a known-good version to diff against: run `reference/verify.sh`. If it needs a tool like `jq`, install it and run it again.
3. **Report**: the guard should block `.env` and `rm -rf`, the sample skill and the MCP server should check out, and you should be able to explain the host's plugin layout in plain words.

## How each host is laid out

The two hosts package plugins differently, and a Claude Code plugin does **not** load in OpenCode.

- **Claude Code:** a **marketplace** at the root (`.claude-plugin/marketplace.json`) lists a **plugin** in `plugins/<name>/`, each with its own `.claude-plugin/plugin.json`, plus `skills/`, `agents/`, and `hooks/`. (Step 1 installs the skill that teaches the current shape.)
- **OpenCode:** a **separate** system — JS/TS modules in `.opencode/plugins/` that export functions returning a hooks object (e.g. `tool.execute.before`).

What crosses between the two is the **skill content** (both read `SKILL.md`); the packaging and the hooks you redo per host.

## How to write the parts so they travel

- **Keep skill bodies tool-agnostic.** Frontmatter `name` + `description` only. No `$ARGUMENTS`, no `allowed-tools`, no host-specific frontmatter — that is what lets one skill serve Claude Code, OpenCode, and more.
- **Write hooks per host.** They do not port: Claude Code in `hooks/` (wired by `hooks.json`), OpenCode in `.opencode/plugins/`.
- **Always prove it.** After you build a lever, demonstrate it working: try the thing the guard should block and show it blocked; run the skill; show the subagent reporting. "It should work" is not done.

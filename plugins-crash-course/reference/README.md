# reference/ — a complete, proven `agent-factory` build

This is the finished version of the plugin you are building one level up. Read it to see what "correct" looks like, and **diff your own work against it** when something is off. Do not copy it wholesale — building it yourself, then comparing here, is the point.

It is a **marketplace** (`.claude-plugin/marketplace.json` is the catalog) with one **plugin** in `plugins/agent-factory/`, plus a runnable MCP server in `server/`.

```
reference/
├── .claude-plugin/marketplace.json     # the catalog (lists the plugin below)
├── plugins/
│   └── agent-factory/                   # THE PLUGIN
│       ├── .claude-plugin/plugin.json
│       ├── skills/loop-engineering/SKILL.md   # a model portable skill — read it before writing yours
│       ├── agents/reviewer.md                 # a model subagent: reviews in its own context, only reports
│       ├── hooks/{hooks.json,format.sh,block-secrets.sh}   # the proven guard — exit 2 blocks
│       ├── .mcp.json.example                  # the MCP wiring template (4th lever)
│       ├── .opencode/plugins/guards.ts         # the SAME guard for OpenCode (hooks don't port)
│       ├── AGENTS.md                          # the plugin's house rules (the instructions lever)
│       └── tests/test_hooks.sh
└── server/                              # a runnable MCP server you point the plugin at
    ├── index.js                         # Streamable HTTP + bearer auth, one tool
    ├── test_server.mjs                  # proves auth blocks + the tool lists/calls
    └── package.json
```

## Prove this reference is sound

```bash
./verify.sh        # one command: symlinks, jq, hook tests (exit 2/2/0), server test, plugin validate
```

Or just the guard:

```bash
./setup.sh                                       # symlinks inside the plugin
bash plugins/agent-factory/tests/test_hooks.sh   # ALL PASS — guard exits 2 on .env / rm -rf
```

## The MCP lever: run it locally, point the plugin at it

The fourth lever is an MCP server, and it is **remote by design**: the plugin holds only a pointer (`.mcp.json.example`); the server runs somewhere you control. You do not author this server — you run it and wire it.

```bash
cd server && npm install
npm test                                   # ALL PASS — unauthorized key rejected; authorized lists + calls
AGENT_FACTORY_KEY=dev-key npm start        # serves on http://localhost:3000/mcp
```

`server/index.js` is a complete remote MCP server: an `McpServer` behind the **Streamable HTTP** transport, in Express, with the auth check running *first*. It uses a **bearer token** — the pragmatic minimum, and your subscription gate (billing sets or revokes `AGENT_FACTORY_KEY` per customer). The full production build — OAuth 2.1, the data behind the tool, hosting — is the *Connector-Native Apps* course.

**Wire the plugin to it** — copy the template, point it at your URL:

```bash
cp plugins/agent-factory/.mcp.json.example plugins/agent-factory/.mcp.json
# edit the url (use http://localhost:3000/mcp to test locally); set AGENT_FACTORY_KEY
```

## What this plugin runs and touches (the trust contract)

- **Installs:** one model skill (`loop-engineering`), a `reviewer` subagent, two hooks, and an optional remote MCP wiring.
- **Hooks that run:** `format.sh` after every Write/Edit (`prettier`); `block-secrets.sh` before Read/Edit/Write/Bash.
- **Files inspected:** only `tool_input.file_path` and `tool_input.command` from the hook event. It never opens `.env` — it blocks reads of it.
- **Commands executed:** `prettier` (via `npx`). Nothing else runs locally.
- **Network access:** none locally. If you wire `.mcp.json`, the agent talks to *your* server over HTTP(S) — you own that surface.

## Notes for publishing

- The plugin's two symlinks point **inside** the plugin, so they survive Claude Code's copy-to-cache on install. Don't add `../`-escaping paths.
- Pin plugin versions in `marketplace.json` with `ref`/`sha` once you host it.
- Run `claude plugin validate ./plugins/agent-factory` (needs the Claude Code CLI) before publishing.
- Pin `server/`'s `@modelcontextprotocol/sdk` to v1.x (v2 is pre-alpha) and re-run `npm test` after `npm install`.

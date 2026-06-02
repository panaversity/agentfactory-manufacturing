# Dynamic Workforce base (Manufacturing track)

The starting point for the **From Fixed to Dynamic Workforce** crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). It picks up where the Workforce with Paperclip course left off: you have a managed workforce, and now the workforce learns to **grow itself**. You direct; your coding agent detects a capability gap, drafts a hire, walks it through the board's approval gate, and provisions a new Worker, all from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the work; you brief, review, and approve.

What is here:

- `AGENTS.md` carries the standing operations brief (PART 2 verified against a live install; PART 3 re-verified against the Paperclip `master` source at v2026.529.0). Beyond the management plane it covers the **hiring lifecycle**: the `agent-hires` endpoint, the approval-collaboration loop, the real Worker lifecycle verbs (pause, resume, terminate, delete), Paperclip's real **authority layer** (permission grants, scopes, and per-issue execution policy, not just free-text `capabilities`), routines for recurring work, and the talent-ledger queries. `CLAUDE.md` loads it when your agent opens the folder.- `.env.example` documents the optional provider key, which you export in your shell, never store here.

Prerequisites:

- **Node.js 20+** (`npx paperclipai onboard` is a Node CLI).
- **The two local coding-agent CLIs**, `claude` and `opencode`, installed and authenticated. The new Worker runs on `claude_local` or `opencode_local`: Paperclip spawns the CLI headless on each heartbeat. Install whichever you want to run (both, to follow the side-by-side lab).
- **A running workforce to hire into.** This course grows the baseline company from the Workforce with Paperclip course (a CEO and a CMO). The course's first prompt stands that baseline up if you do not already have it.

On the first prep prompt your agent installs Paperclip's own operator skills (`paperclip-create-agent`, `diagnose-why-work-stopped`, and `paperclip`, the heartbeat and approval-reconcile authority) so the hire and recovery flows stay current with Paperclip's upstream MIT-licensed skills. This course is the hiring-and-governance loop, not skill authoring (you learned that earlier on the track): spotting a gap and proving a hire on probation are judgment your agent applies, not skills it builds.

How this base differs from the SDK bases on this track: Paperclip ships its own embedded Postgres and is driven through its CLI and REST API, so there is no Neon, no Context7, and no `.mcp.json` here. The talent ledger the course queries is Paperclip's own `activity_log` and `cost_events`. The whole development plane is the local Paperclip install from `npx paperclipai onboard --yes` (keyless loopback: no account, no cloud). The only place a provider key is needed is the runtime the new Worker uses, exported in your shell.

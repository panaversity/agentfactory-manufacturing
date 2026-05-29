# Dynamic Workforce base (Manufacturing track)

The starting point for the **From Fixed to Dynamic Workforce** crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). It picks up where the Workforce with Paperclip course left off: you have a managed workforce, and now the workforce learns to **grow itself**. You direct; your coding agent detects a capability gap, drafts a hire, walks it through the board's approval gate, and provisions a new Worker, all from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course. The agent does the work; you brief, review, and approve.

What is here:

- `AGENTS.md` carries the standing operations brief (verified against a live install). Beyond the management plane it now covers the **hiring lifecycle**: the `agent-hires` endpoint, the approval-collaboration loop, the real Worker lifecycle verbs (pause, resume, terminate), and the talent-ledger queries. `CLAUDE.md` loads it when your agent opens the folder.
- `.claude/skills/capability-gap-detector/` is the one **building skill** this base ships: the judgment layer that notices when no current Worker can handle the work and recommends hire vs escalate vs queue vs decline. It is a **starter you improve**, not a finished tool. Paperclip's own skills carry the mechanics; this carries the judgment.
- `.env.example` documents the optional provider key, which you export in your shell, never store here.

Prerequisites:

- **Node.js 20+** (`npx paperclipai onboard` is a Node CLI).
- **The two local coding-agent CLIs**, `claude` and `opencode`, installed and authenticated. The new Worker runs on `claude_local` or `opencode_local`: Paperclip spawns the CLI headless on each heartbeat. Install whichever you want to run (both, to follow the side-by-side lab).
- **A running workforce to hire into.** This course extends the three-Worker company from the Workforce with Paperclip course. Complete that course (or stand up its base) first; there is no shortcut for the Part 4 lab.

The skill-first move: your agent installs Paperclip's operator skills on the first prep prompt (`paperclip-create-agent`, `diagnose-why-work-stopped`, and `paperclip`, the heartbeat and approval-reconcile authority) so the hire and recovery flows stay current with Paperclip's own upstream MIT-licensed skills. You improve the shipped `capability-gap-detector` skill for your own company, and you **generate the companion eval-pack runner with `skill-creator`** (its eval harness maps directly onto the course's scored rubric). You leave with skills you own, not just code you ran.

How this base differs from the SDK bases on this track: Paperclip ships its own embedded Postgres and is driven through its CLI and REST API, so there is no Neon, no Context7, and no `.mcp.json` here. The talent ledger the course queries is Paperclip's own `activity_log` and `cost_events`. The whole development plane is the local Paperclip install from `npx paperclipai onboard --yes` (keyless loopback: no account, no cloud). The only place a provider key is needed is the runtime the new Worker uses, exported in your shell.

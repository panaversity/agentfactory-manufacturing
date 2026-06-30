# Manufacturing Track Bases

Per-course starting environments for the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org).

Each folder here is the **base** for one crash course: rules files, MCP wiring, and an env template. On this track you direct, and your coding agent builds the project on top of the base from prompts you paste. Each course's Quick Win walks you through it, and your agent does the setup itself.

| Course                               | Folder                                                | Download                                                                                              |
| ------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Connector-Native Apps                | [`connector-native-apps/`](connector-native-apps)     | [`connector-native-apps-base.zip`](../../releases/latest/download/connector-native-apps-base.zip)     |
| Plugins for AI Agents                | [`plugins-crash-course/`](plugins-crash-course)       | [`plugins-crash-course-base.zip`](../../releases/latest/download/plugins-crash-course-base.zip)       |
| RAG on Postgres (pgvector)           | [`postgres-ai/`](postgres-ai)                         | [`postgres-ai-base.zip`](../../releases/latest/download/postgres-ai-base.zip)                         |
| Digital FTE                          | [`digital-fte/`](digital-fte)                         | [`digital-fte-base.zip`](../../releases/latest/download/digital-fte-base.zip)                         |
| AI Agent Nervous System              | [`ai-agent-nervous-system/`](ai-agent-nervous-system) | [`ai-agent-nervous-system-base.zip`](../../releases/latest/download/ai-agent-nervous-system-base.zip) |
| Workforce with Paperclip             | [`paperclip-workforce/`](paperclip-workforce)         | [`paperclip-workforce-base.zip`](../../releases/latest/download/paperclip-workforce-base.zip)         |
| Eval-Driven Development              | [`eval-driven-development/`](eval-driven-development) | [`eval-driven-development-base.zip`](../../releases/latest/download/eval-driven-development-base.zip) |
| Owner Delegation with Identic AI     | [`identic-ai/`](identic-ai)                           | [`identic-ai-base.zip`](../../releases/latest/download/identic-ai-base.zip)                           |
| AI Identity (Sign-In & Agent Access) | [`ai-identity/`](ai-identity)                         | [`ai-identity-base.zip`](../../releases/latest/download/ai-identity-base.zip)                         |

The bases share one spine: Neon and Context7 over MCP, database work through Neon MCP only (dev-plane), audit in the same transaction, and skills the agent installs (`skill-creator`, `mcp-builder`, plus whatever a course needs). They differ in that skill set, which is why each course gets its own folder. The Paperclip base is the exception: Paperclip ships its own embedded Postgres and is driven through its CLI and REST API, so that base has no Neon, no Context7, and no `.mcp.json`; the skills it installs are Paperclip's own operator skills (`paperclip-create-agent`, `diagnose-why-work-stopped`). The Eval-Driven Development base adds one more spine member: a local, keyless `phoenix` MCP (`@arizeai/phoenix-mcp` against `http://localhost:6006`) alongside Neon and Context7, dormant until the course launches Phoenix. The Identic AI base keeps the Neon + Context7 spine for its governance ledger and verify-before-you-code habit, and adds the official `paperclip` MCP (`@paperclipai/mcp-server`, against a local sandbox) as a third server, so an OpenClaw delegate can read and resolve approvals without a hand-written client. The Plugins for AI Agents base is the other exception: it teaches you to build a coding-agent plugin, not a data agent, so it carries no Neon, no Context7, and no `.mcp.json` spine. Instead it ships a `reference/` proven build of the plugin you make (with its own `verify.sh` green-gate and a runnable MCP server to wire), and the agent installs the official `Plugin Structure` skill rather than the data spine's skills. The AI Identity base is an exception of the same kind: it teaches you to build an identity service, not a data agent, so it carries no Context7 and no `.mcp.json` spine. Like the others it is lean — rules, a library of `specs/` with adversarial acceptance criteria, the reader prompts, and one shipped skill (`agent-identity-issuer`, the gap the official skills leave: OIDC/OAuth issuance and agent identity). It pre-builds no app: `specs/00-set-up-the-base` directs the agent to scaffold Next.js + shadcn, install the official Better Auth skills, and pin the Better Auth 1.7 line (where CIMD lives). Its Postgres is Neon as the app's own store (`@neondatabase/serverless`, no native build), not the Neon-MCP dev-plane; the OAuth/OIDC issuer is the thing you manufacture.

## How a base is used

Open a course folder in your coding agent (Claude Code or OpenCode). `CLAUDE.md` loads `AGENTS.md`, which carries the standing rules and tells the agent how to install the course's skills and confirm the MCP servers. Then follow the course.

## Reference solutions

The `worked-examples/` folder holds the **finished build** for a course, for after you have done it yourself. These are full reference solutions (the complete code, verified end to end), not bare bases, so they are deliberately kept out of the release zips. Treat them as the answer key: read them when you are stuck or want to compare, not as your starting point.

| Course                               | Reference solution                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Connector-Native Apps                | [`worked-examples/connector-native-apps/`](worked-examples/connector-native-apps)     |
| Digital FTE                          | [`worked-examples/digital-fte/`](worked-examples/digital-fte)                         |
| Owner Delegation with Identic AI     | [`worked-examples/identic-ai/`](worked-examples/identic-ai)                           |
| Give Your AI Agent a Nervous System  | [`worked-examples/ai-agent-nervous-system/`](worked-examples/ai-agent-nervous-system) |
| AI Identity (Sign-In & Agent Access) | [`worked-examples/ai-identity/`](worked-examples/ai-identity)                         |

## Adding a course

Add a folder with the base files (copy an existing one, adjust `AGENTS.md`'s skill list and `.mcp.json` if the course needs another server). On the next `v*` tag, CI builds `<folder>-base.zip` and attaches it to the Release.

For how a base takes a model credential (free-by-default Gemini, one provider-named key, the agent proves it at setup), follow [`MODEL-PROVIDER-STANDARD.md`](MODEL-PROVIDER-STANDARD.md). `postgres-ai` is the reference implementation.

## License

Apache-2.0.

# Manufacturing Track Bases

Per-course starting environments for the Manufacturing track of [The AI Agent Factory](https://learn.panaversity.org).

Each folder here is the **base** for one crash course: rules files, MCP wiring, and an env template. On this track you direct, and your coding agent builds the project on top of the base from prompts you paste. Each course's Quick Win walks you through it, and your agent does the setup itself.

| Course      | Folder                        | Download                                                                      |
| ----------- | ----------------------------- | ----------------------------------------------------------------------------- |
| Digital FTE | [`digital-fte/`](digital-fte) | [`digital-fte-base.zip`](../../releases/latest/download/digital-fte-base.zip) |

The bases share one spine: Neon and Context7 over MCP, database work through Neon MCP only (dev-plane), audit in the same transaction, and skills the agent installs (`skill-creator`, `mcp-builder`, plus whatever a course needs). They differ in that skill set, which is why each course gets its own folder.

## How a base is used

Open a course folder in your coding agent (Claude Code or OpenCode). `CLAUDE.md` loads `AGENTS.md`, which carries the standing rules and tells the agent how to install the course's skills and confirm the MCP servers. Then follow the course.

## Adding a course

Add a folder with the base files (copy an existing one, adjust `AGENTS.md`'s skill list and `.mcp.json` if the course needs another server). On the next `v*` tag, CI builds `<folder>-base.zip` and attaches it to the Release.

## License

Apache-2.0.

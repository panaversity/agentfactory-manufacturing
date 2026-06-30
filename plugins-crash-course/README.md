# Plugins for AI Agents base (Manufacturing track)

The starting point for the [Plugins for AI Agents](https://agentfactory.panaversity.org/docs/plugins-crash-course) crash course on the Manufacturing track of [The AI Agent Factory](https://agentfactory.panaversity.org). You direct; your coding agent builds a real plugin on top of this base from prompts you paste.

Open this folder in your coding agent (Claude Code or OpenCode) and follow the course's Quick Win. The agent does the setup itself: on Claude Code it installs the official plugin-structure skill, on OpenCode it reads the plugin docs, then it runs the reference build's checks.

What is here:

- `AGENTS.md` is your brief: what you are building (one plugin, four levers), how each host lays out a plugin, and the setup steps the agent runs. `CLAUDE.md` loads it when your agent opens the folder.
- `reference/` is a complete, **proven** build of the plugin you will build yourself, with a one-command `reference/verify.sh` green-gate. Read it and diff against it; do not copy it.
- `reference/server/` is a runnable MCP server you point your plugin at (you run it, you do not author it).
- `.gitignore` keeps secrets, build artifacts, and the symlinks `reference/setup.sh` regenerates out of git.

You build your own marketplace and plugin at the root of this folder, lever by lever, comparing each piece to `reference/`.

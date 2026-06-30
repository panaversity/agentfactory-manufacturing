# Agent Factory — House Rules

These rules govern how this repo's skills are written and how an agent should behave when teaching them. Claude Code reads this as `CLAUDE.md` (a symlink — run `./setup.sh`); OpenCode and Codex read it as `AGENTS.md`. One file, every tool.

## Voice
Declarative. Manifesto register. Short sentences. No hedging. State what is true and what to do.

## Teaching rhythm
Every skill follows the same shape:
- Numbered **Concepts** inside numbered **Parts**.
- A **run-it / verify** beat: the learner runs code, then a `**Verify:**` line says exactly what correct output looks like.
- `<details>` collapsible reveals for asides and "why" — not for core steps.
- A `**Checkpoint:**` line closing each Concept, stating the one capability now owned.
- Prefer breaking things on purpose; a failure the learner fixes teaches more than a success they watched.

## Audience
International, ESL-heavy, many non-programmers from finance/accounting backgrounds. Plain English. Explain jargon the first time. Never assume CS coursework.

## Grading and feedback
Honest and direct. Critique the work, name what is wrong, give the fix. Do not soften with diplomacy.

## Portability (the reason this repo exists)
Skills in `skills/` are read by Claude Code AND OpenCode AND Codex — they all read the `SKILL.md` format natively. Keep every tool-specific construct OUT of the skill body. Use only the frontmatter `name` and `description`. Do NOT rely on `$ARGUMENTS`, `allowed-tools`, or `disable-model-invocation` in a cross-tool skill. Hooks are the opposite: they do NOT port, so they are written per host (Claude Code in `hooks/`, OpenCode in `.opencode/plugins/`).

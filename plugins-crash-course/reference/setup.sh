#!/usr/bin/env bash
# One-time local setup for the plugin inside this marketplace repo.
set -euo pipefail
cd "$(dirname "$0")/plugins/agent-factory"

# Claude Code reads CLAUDE.md; OpenCode/Codex read AGENTS.md. One file, two names.
ln -sf AGENTS.md CLAUDE.md

# OpenCode discovers skills from .opencode/skills/. Point it at the plugin's own
# skills/ so there's one source of truth. (Target is inside the plugin, so it
# survives Claude Code's copy-to-cache on install.)
mkdir -p .opencode
ln -sf ../skills .opencode/skills

echo "Linked inside plugins/agent-factory: CLAUDE.md -> AGENTS.md, .opencode/skills -> ../skills"

#!/usr/bin/env bash
# PostToolUse (Write|Edit): format whatever the agent just wrote.
# The model's styling no longer matters — this normalizes every edit.
path=$(jq -r '.tool_input.file_path // empty')
[[ -n "$path" && -f "$path" ]] && npx --yes prettier --write "$path" >/dev/null 2>&1
exit 0

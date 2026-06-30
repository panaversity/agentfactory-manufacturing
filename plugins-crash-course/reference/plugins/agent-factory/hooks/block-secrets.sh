#!/usr/bin/env bash
# PreToolUse (Read|Edit|Write|Bash): block what must never happen.
# Exit 2 = blocked; stderr is handed to the model as the reason. Exit 1 would NOT block.
input=$(cat)                                                      # read the event ONCE
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

# 1) never touch secret files
if [[ "$path" == *.env* || "$path" == */secrets/* ]]; then
  echo "Blocked: $path is a secret file. Do not read or edit it." >&2
  exit 2
fi

# 2) never run obviously destructive shell commands
if [[ "$cmd" == *"rm -rf"* || "$cmd" == *"git push --force"* ]]; then
  echo "Blocked: refusing to run a destructive command ($cmd)." >&2
  exit 2
fi

exit 0

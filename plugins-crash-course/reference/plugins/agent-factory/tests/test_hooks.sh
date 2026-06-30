#!/usr/bin/env bash
# Smoke test for the guard hook — proves it BLOCKS (exit 2), not just warns.
# Run: bash tests/test_hooks.sh   (needs jq)
set -u
H="$(dirname "$0")/../hooks/block-secrets.sh"
fail=0

check () { # description expected_exit json
  echo "$3" | bash "$H" >/dev/null 2>&1
  got=$?
  if [[ "$got" == "$2" ]]; then echo "  ok: $1 (exit $got)"
  else echo "  FAIL: $1 — expected $2, got $got"; fail=1; fi
}

echo "block-secrets.sh:"
check "reading .env is blocked"        2 '{"tool_input":{"file_path":"/app/.env"}}'
check "reading secrets/ is blocked"    2 '{"tool_input":{"file_path":"/app/secrets/key.pem"}}'
check "rm -rf is blocked"              2 '{"tool_input":{"command":"rm -rf /"}}'
check "normal file is allowed"         0 '{"tool_input":{"file_path":"/app/main.ts"}}'
check "normal command is allowed"      0 '{"tool_input":{"command":"ls -la"}}'

[[ "$fail" == 0 ]] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }

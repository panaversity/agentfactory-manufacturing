#!/usr/bin/env bash
# verify.sh — one command that proves this starter base is sound.
# Run from the agent-factory/ root. Exits non-zero if anything fails.
# This is the base's green-gate: if it is not all-GREEN, the base is not shippable,
# and no course prose should claim a step is "tested." (See VERIFIED-FACTS.md.)
set -u
cd "$(dirname "$0")"
fail=0
ok(){ printf "  \033[32mGREEN\033[0m %s\n" "$1"; }
no(){ printf "  \033[31mRED  \033[0m %s\n" "$1"; fail=1; }

echo "== 1. setup.sh (symlinks) =="
if bash setup.sh >/dev/null 2>&1 \
   && [ -L plugins/agent-factory/CLAUDE.md ] \
   && [ -L plugins/agent-factory/.opencode/skills ]; then
  ok "setup.sh created both symlinks"
else
  no "setup.sh / symlinks (Windows or no-symlink FS? hooks+server still work; skills won't port)"
fi

echo "== 2. jq present (hooks need it) =="
command -v jq >/dev/null && ok "jq found" || no "jq missing — install jq"

echo "== 3. hook tests =="
if bash plugins/agent-factory/tests/test_hooks.sh 2>/dev/null | grep -q "ALL PASS"; then
  ok "test_hooks.sh ALL PASS"
else
  no "test_hooks.sh did not report ALL PASS"
fi

echo "== 4. raw guard exit codes (exit-2 blocks; stdin read once) =="
g=plugins/agent-factory/hooks/block-secrets.sh
c1=$(echo '{"tool_input":{"file_path":"/app/.env"}}'    | bash "$g" >/dev/null 2>&1; echo $?)
c2=$(echo '{"tool_input":{"command":"rm -rf /"}}'       | bash "$g" >/dev/null 2>&1; echo $?)
c3=$(echo '{"tool_input":{"file_path":"/app/main.ts"}}' | bash "$g" >/dev/null 2>&1; echo $?)
[ "$c1" = 2 ] && [ "$c2" = 2 ] && [ "$c3" = 0 ] \
  && ok ".env=2 rm-rf=2 normal=0" || no "guard exit codes were $c1/$c2/$c3 (want 2/2/0)"

echo "== 5. MCP server (npm install + test) =="
if ( cd server && npm install --no-audit --no-fund >/dev/null 2>&1 \
     && node test_server.mjs 2>/dev/null | grep -q "ALL PASS" ); then
  sdk=$(node -e "console.log(require('./server/node_modules/@modelcontextprotocol/sdk/package.json').version)" 2>/dev/null)
  ok "server test ALL PASS (sdk ${sdk:-?})"
else
  no "server npm install or test_server.mjs failed (network? SDK v2 breaking change?)"
fi

echo "== 6. claude plugin validate =="
if command -v claude >/dev/null; then
  if claude plugin validate ./plugins/agent-factory 2>&1 | grep -qi "passed"; then
    ok "claude plugin validate passed"
  else
    no "claude plugin validate did not pass"
  fi
else
  printf "  \033[33mSKIP \033[0m claude CLI not found (run this in Claude Code)\n"
fi

echo
if [ "$fail" = 0 ]; then
  printf "\033[32mBASE GREEN — shippable.\033[0m\n"
else
  printf "\033[31mBASE NOT GREEN — fix before shipping or claiming 'tested'.\033[0m\n"
fi
exit $fail

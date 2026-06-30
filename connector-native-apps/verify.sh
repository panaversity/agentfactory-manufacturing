#!/usr/bin/env bash
# verify.sh — one command that proves this starter base is sound.
# Run from the base root. Exits non-zero if anything fails.
# The OFFLINE green-gate: the security core (auth.py + session.py) loads and its five smoke tests
# pass with no DB/network. The LIVE legs (FastMCP gateway, Neon store, cloudflared tunnel, adding
# the URL to claude.ai) are built through the course and proven end to end there — see
# VERIFIED-FACTS.md. If this gate is not all-GREEN, the base is not shippable.
set -u
cd "$(dirname "$0")"
fail=0
ok(){ printf "  \033[32mGREEN\033[0m %s\n" "$1"; }
no(){ printf "  \033[31mRED  \033[0m %s\n" "$1"; fail=1; }

echo "== 1. uv present =="
command -v uv >/dev/null && ok "uv $(uv --version 2>/dev/null)" || { no "uv missing — https://docs.astral.sh/uv/"; }

echo "== 2. the two GIVEN files exist (must NOT be regenerated) =="
[ -f src/connector_app/auth.py ] && [ -f src/connector_app/session.py ] \
  && ok "auth.py + session.py present" || no "a GIVEN security file is missing"

echo "== 3. uv sync (dev deps) =="
if uv sync --extra dev >/dev/null 2>&1; then ok "deps installed"; else no "uv sync failed (network?)"; fi

echo "== 4. five smoke tests (offline: imports/token/audience/isolation/fail-closed) =="
out=$(uv run pytest -q 2>&1)
if printf '%s' "$out" | grep -qE "5 passed"; then
  ok "pytest: 5 passed"
else
  no "pytest did not report 5 passed — $(printf '%s' "$out" | tail -1)"
fi

echo "== 5. live-connector skill present (Part 5 tunnel) =="
[ -f .claude/skills/live-connector/SKILL.md ] && ok "live-connector skill ships in the base" \
  || no ".claude/skills/live-connector/SKILL.md missing"

echo
if [ "$fail" = 0 ]; then
  printf "\033[32mBASE GREEN — security core shippable. (Live tunnel + claude.ai legs: see VERIFIED-FACTS.md.)\033[0m\n"
else
  printf "\033[31mBASE NOT GREEN — fix before shipping or claiming 'tested'.\033[0m\n"
fi
exit $fail

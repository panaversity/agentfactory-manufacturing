#!/usr/bin/env bash
#
# cimd-verify.sh — proves the @better-auth/cimd 1.7.0-rc.0 wiring in src/lib/auth.ts.
#
# It boots AuthCo (with the cimd() plugin enabled), then runs an INDEPENDENT
# consumer (cimd-consumer/cimd-flow.mjs) that identifies itself with a URL
# `client_id` (a Client ID Metadata Document hosted over loopback HTTP) instead
# of a pre-registered client. Each check prints PASS/FAIL.
#
# Happy path:
#   - CIMD-1  authorization-code + PKCE completes for a URL client_id (public client)
#   - CIMD-2  the ID token verifies offline via JWKS (aud == the URL client_id)
#   - CIMD-3  CIMD persisted a PUBLIC client row (no client_secret) keyed by the URL
#             (NOTE: the draft-style "no DB row" expectation is FALSE for this impl;
#              CIMD caches a refreshable public client. This check documents reality.)
#   - CIMD-4  discovery advertises client_id_metadata_document_supported = true
#
# Adversarial (all must be rejected / fail closed, with NO token issued):
#   - CIMD-5  non-loopback HTTP client_id (HTTPS required off-loopback)
#   - CIMD-6  client_id URL containing a fragment
#   - CIMD-7  client_id URL containing userinfo (credentials)
#   - CIMD-8  metadata doc whose redirect_uris omit the requested redirect_uri
#   - CIMD-9  document served as non-JSON (text/html) fails closed
#   - CIMD-10 unreachable document fails closed
#
# Run from the project root: ./cimd-verify.sh   (requires ./verify.sh to have
# installed deps at least once, or a prior `pnpm install`).
set -uo pipefail
cd "$(dirname "$0")"

PORT=3000
BASE="http://localhost:${PORT}"
AUTH="${BASE}/api/auth"
OUT="./cimd-out"
SERVER_LOG="${OUT}/server.log"
BODIES_LOG="${OUT}/bodies.log"
RESULT_FILE="${OUT}/result.json"
PASS=0; FAIL=0
declare -a RESULTS

rm -rf "$OUT"; mkdir -p "$OUT"; : > "$BODIES_LOG"

say()  { printf '%s\n' "$*"; }
ok()   { RESULTS+=("PASS  $1  -- $2"); PASS=$((PASS+1)); }
bad()  { RESULTS+=("FAIL  $1  -- $2"); FAIL=$((FAIL+1)); }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
}
trap cleanup EXIT

# --- env + secrets (reuse the same .env as verify.sh) ----------------------
if [[ ! -f .env ]]; then say "ERROR: .env missing; run ./verify.sh first."; exit 1; fi
set -a; . ./.env; set +a

# Link jose for the consumer if needed.
if [[ ! -e node_modules/jose ]]; then
  JOSE_DIR="$(find node_modules/.pnpm -maxdepth 1 -type d -name 'jose@*' | head -1)"
  [[ -n "$JOSE_DIR" ]] && ln -sfn "../${JOSE_DIR}/node_modules/jose" node_modules/jose
fi

# Fresh schema each run (deterministic). The Notes seed is harmless here; CIMD
# clients are created on the fly from their metadata documents.
rm -f ./sqlite.db
say "[setup] running Better Auth migration..."
npx -y @better-auth/cli@latest migrate -y >/dev/null 2>&1 || npx @better-auth/cli@latest migrate -y >"${OUT}/migrate.log" 2>&1

# --- boot server -----------------------------------------------------------
say "[setup] starting next dev (logs -> ${SERVER_LOG})..."
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 2
pnpm dev > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
UP=""
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "${AUTH}/ok"; then UP=1; break; fi
  sleep 1
done
if [[ -z "$UP" ]]; then say "ERROR: server did not come up"; tail -20 "$SERVER_LOG"; exit 1; fi
say "[setup] server is up."
say ""

# --- run the CIMD consumer -------------------------------------------------
say "[flow] running independent CIMD consumer (URL client_id + metadata document)..."
AUTHCO_URL="$BASE" SQLITE_PATH="./sqlite.db" BODIES_LOG="$BODIES_LOG" RESULT_FILE="$RESULT_FILE" \
  node cimd-consumer/cimd-flow.mjs > "${OUT}/consumer.stdout" 2>&1
RC=$?
if [[ $RC -ne 0 ]]; then say "[flow] consumer exited non-zero:"; cat "${OUT}/consumer.stdout"; fi

chk() { node -e "const r=require('${RESULT_FILE}');process.stdout.write(r.checks['$1']===true?'1':'0')" 2>/dev/null || printf '0'; }
ev()  { node -e "const r=require('${RESULT_FILE}');process.stdout.write(String(r.evidence['$1']||''))" 2>/dev/null; }

[[ "$(chk cimd_flow_completes)" == "1" ]] && ok "CIMD-1" "auth-code+PKCE completed for URL client_id; $(ev cimd_flow_completes)" || bad "CIMD-1" "flow did not complete ($(ev cimd_flow_completes))"
[[ "$(chk cimd_idtoken_verifies)" == "1" ]] && ok "CIMD-2" "ID token verified via JWKS; $(ev cimd_idtoken_verifies)" || bad "CIMD-2" "ID token did not verify ($(ev cimd_idtoken_verifies))"
[[ "$(chk cimd_no_preregistered_secret_client)" == "1" ]] && ok "CIMD-3" "CIMD persisted a PUBLIC client row, no secret; $(ev db_row_after)" || bad "CIMD-3" "unexpected client row state ($(ev db_row_after))"
[[ "$(chk cimd_discovery_key)" == "1" ]] && ok "CIMD-4" "discovery advertises CIMD; $(ev cimd_discovery_key)" || bad "CIMD-4" "discovery key missing ($(ev cimd_discovery_key))"
[[ "$(chk adv_http_nonloopback_rejected)" == "1" ]] && ok "CIMD-5" "non-loopback HTTP client_id rejected; $(ev adv_http_nonloopback_rejected)" || bad "CIMD-5" "not rejected ($(ev adv_http_nonloopback_rejected))"
[[ "$(chk adv_fragment_rejected)" == "1" ]] && ok "CIMD-6" "fragment client_id rejected; $(ev adv_fragment_rejected)" || bad "CIMD-6" "not rejected ($(ev adv_fragment_rejected))"
[[ "$(chk adv_userinfo_rejected)" == "1" ]] && ok "CIMD-7" "userinfo/credentials client_id rejected; $(ev adv_userinfo_rejected)" || bad "CIMD-7" "not rejected ($(ev adv_userinfo_rejected))"
[[ "$(chk adv_redirect_mismatch_rejected)" == "1" ]] && ok "CIMD-8" "redirect_uri not in metadata doc rejected; $(ev adv_redirect_mismatch_rejected)" || bad "CIMD-8" "not rejected ($(ev adv_redirect_mismatch_rejected))"
[[ "$(chk adv_nonjson_failsclosed)" == "1" ]] && ok "CIMD-9" "non-JSON document fails closed; $(ev adv_nonjson_failsclosed)" || bad "CIMD-9" "did not fail closed ($(ev adv_nonjson_failsclosed))"
[[ "$(chk adv_unreachable_failsclosed)" == "1" ]] && ok "CIMD-10" "unreachable document fails closed; $(ev adv_unreachable_failsclosed)" || bad "CIMD-10" "did not fail closed ($(ev adv_unreachable_failsclosed))"

say ""
say "================ CIMD CHECKS ================"
for line in "${RESULTS[@]}"; do say "$line"; done
say "============================================"
say "PASS: ${PASS}   FAIL: ${FAIL}"
[[ $FAIL -eq 0 ]] && { say "ALL CIMD CHECKS PASSED"; exit 0; } || { say "SOME CIMD CHECKS FAILED"; exit 1; }

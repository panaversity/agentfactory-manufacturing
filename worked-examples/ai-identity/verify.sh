#!/usr/bin/env bash
#
# verify.sh — boots AuthCo and checks every acceptance criterion (AC-1..AC-10)
# from specs/sso-server/spec.md. Each check prints PASS/FAIL with its AC number.
#
# It is self-contained: generates .env if missing, runs the Better Auth schema
# migration, seeds the registered "Notes" client, links jose for the consumer,
# starts `next dev`, runs the curl + independent-consumer checks, and tears the
# server down at the end. Run from the project root: ./verify.sh
#
set -uo pipefail
cd "$(dirname "$0")"

PORT=3000
BASE="http://localhost:${PORT}"
AUTH="${BASE}/api/auth"
OUT="./verify-out"
SERVER_LOG="${OUT}/server.log"
BODIES_LOG="${OUT}/bodies.log"
RESULT_FILE="${OUT}/result.json"
PASS=0; FAIL=0
declare -a RESULTS

rm -rf "$OUT"; mkdir -p "$OUT"
: > "$BODIES_LOG"

say()  { printf '%s\n' "$*"; }
ok()   { RESULTS+=("PASS  $1  -- $2"); PASS=$((PASS+1)); }
bad()  { RESULTS+=("FAIL  $1  -- $2"); FAIL=$((FAIL+1)); }
# capture a response body into the leak-scan log
cap()  { printf '\n===== %s =====\n%s\n' "$1" "$2" >> "$BODIES_LOG"; }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Setup: env, secrets, schema, client, jose link
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  say "[setup] .env not found — generating one with fresh secrets."
  SEC="$(openssl rand -base64 32)"; CS="$(openssl rand -base64 32)"; PW="Sup3rSecret-Passw0rd!"
  {
    echo "BETTER_AUTH_SECRET=${SEC}"
    echo "BETTER_AUTH_URL=${BASE}"
    echo "NOTES_CLIENT_ID=notes-app"
    echo "NOTES_CLIENT_SECRET=${CS}"
    echo "NOTES_REDIRECT_URI=http://localhost:4567/callback"
    echo "TEST_USER_EMAIL=ac1-user@example.com"
    echo "TEST_USER_PASSWORD=${PW}"
    echo "NOTES_USER_EMAIL=notes-user@example.com"
    echo "NOTES_USER_PASSWORD=${PW}"
  } > .env
fi
set -a; . ./.env; set +a

# Link jose (used by the independent consumer) from the pnpm store if needed.
if [[ ! -e node_modules/jose ]]; then
  JOSE_DIR="$(find node_modules/.pnpm -maxdepth 1 -type d -name 'jose@*' | head -1)"
  if [[ -n "$JOSE_DIR" ]]; then ln -sfn "../${JOSE_DIR}/node_modules/jose" node_modules/jose; fi
fi

# Fresh schema each run so AC-9 (single-use) and AC-1 (sign-up) are deterministic.
rm -f ./sqlite.db
say "[setup] running Better Auth migration..."
npx -y @better-auth/cli@latest migrate -y >/dev/null 2>&1 || npx @better-auth/cli@latest migrate -y >"${OUT}/migrate.log" 2>&1
say "[setup] seeding registered Notes client..."
node scripts/seed-client.mjs >/dev/null 2>&1

# ---------------------------------------------------------------------------
# 1. Boot the dev server
# ---------------------------------------------------------------------------
say "[setup] starting next dev (logs -> ${SERVER_LOG})..."
# Free the port from any prior run.
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

# ===========================================================================
# AC-1  sign-up then sign-in returns a session; protected route 200 with it, 401 without.
# ===========================================================================
COOKIES="${OUT}/ac1.cookies"
SU=$(curl -s -H "content-type: application/json" -H "origin: ${BASE}" \
  -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"${TEST_USER_PASSWORD}\",\"name\":\"AC1 User\"}" \
  "${AUTH}/sign-up/email"); cap "ac1-signup" "$SU"
SI=$(curl -s -c "$COOKIES" -H "content-type: application/json" -H "origin: ${BASE}" \
  -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"${TEST_USER_PASSWORD}\"}" \
  "${AUTH}/sign-in/email"); cap "ac1-signin" "$SI"
ME_WITH_CODE=$(curl -s -o "${OUT}/me.json" -w "%{http_code}" -b "$COOKIES" "${BASE}/api/me")
ME_BODY=$(cat "${OUT}/me.json"); cap "ac1-me-with-cookie" "$ME_BODY"
ME_NO_CODE=$(curl -s -o "${OUT}/me_no.json" -w "%{http_code}" "${BASE}/api/me")
cap "ac1-me-no-cookie" "$(cat "${OUT}/me_no.json")"
if [[ "$ME_WITH_CODE" == "200" && "$ME_NO_CODE" == "401" && "$ME_BODY" == *"\"id\""* ]]; then
  ok "AC-1" "protected /api/me = 200 with session, 401 without (got ${ME_WITH_CODE}/${ME_NO_CODE})"
else
  bad "AC-1" "expected 200/401, got ${ME_WITH_CODE}/${ME_NO_CODE}"
fi

# ===========================================================================
# AC-2  discovery doc + JWKS return valid JSON; JWKS has >=1 public key.
# ===========================================================================
# 1.7: OIDC discovery moved to the ISSUER ROOT (/.well-known/...), no longer
# under /api/auth (the plugin's discovery endpoints are now SERVER_ONLY and are
# served by an onRequest hook at the issuer-root path).
DISC=$(curl -s "${BASE}/.well-known/openid-configuration"); cap "ac2-discovery" "$DISC"
JWKS=$(curl -s "${AUTH}/jwks"); cap "ac2-jwks" "$JWKS"
DISC_OK=$(printf '%s' "$DISC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.issuer&&j.jwks_uri&&j.authorization_endpoint&&j.token_endpoint?"1":"0")}catch{process.stdout.write("0")}})')
JWKS_KEYS=$(printf '%s' "$JWKS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String((j.keys||[]).length))}catch{process.stdout.write("0")}})')
if [[ "$DISC_OK" == "1" && "${JWKS_KEYS:-0}" -ge 1 ]]; then
  ok "AC-2" "discovery valid JSON + JWKS has ${JWKS_KEYS} public key(s)"
else
  bad "AC-2" "discovery_ok=${DISC_OK}, jwks_keys=${JWKS_KEYS}"
fi

# ===========================================================================
# AC-3,4,6,8,9 + AC-10(consumer) — run the INDEPENDENT Notes consumer.
# ===========================================================================
say "[flow] running independent Notes consumer (authorization-code flow + JWKS verify)..."
AUTHCO_URL="$BASE" BODIES_LOG="$BODIES_LOG" RESULT_FILE="$RESULT_FILE" \
  node notes-consumer/consumer.mjs > "${OUT}/consumer.stdout" 2>&1
CONSUMER_RC=$?
chk() { # chk <json-key> -> "1"/"0"
  node -e "const r=require('${RESULT_FILE}');process.stdout.write(r.checks['$1']===true?'1':'0')" 2>/dev/null || printf '0'
}
ev() { node -e "const r=require('${RESULT_FILE}');process.stdout.write(String(r.evidence['$1']||''))" 2>/dev/null; }

if [[ $CONSUMER_RC -ne 0 ]]; then
  say "[flow] consumer exited non-zero; see ${OUT}/consumer.stdout"; cat "${OUT}/consumer.stdout"
fi

[[ "$(chk ac3)" == "1" ]] && ok "AC-3" "Notes received a signed ID token ($(ev ac3))" || bad "AC-3" "no signed ID token ($(ev ac3))"
[[ "$(chk ac4)" == "1" ]] && ok "AC-4" "verified via JWKS only; $(ev ac4)" || bad "AC-4" "JWKS verification failed ($(ev ac4))"

# ===========================================================================
# AC-5  No secret leaks in server logs or any HTTP response body.
# ===========================================================================
LEAK=""
scan() { # scan <label> <needle>
  local label="$1" needle="$2"
  [[ -z "$needle" ]] && return 0
  if grep -F -q -- "$needle" "$SERVER_LOG" 2>/dev/null; then LEAK="${LEAK} ${label}:server.log"; fi
  if grep -F -q -- "$needle" "$BODIES_LOG" 2>/dev/null; then LEAK="${LEAK} ${label}:bodies"; fi
}
scan "BETTER_AUTH_SECRET" "$BETTER_AUTH_SECRET"
scan "NOTES_CLIENT_SECRET" "$NOTES_CLIENT_SECRET"
scan "TEST_PASSWORD" "$TEST_USER_PASSWORD"
scan "NOTES_PASSWORD" "${NOTES_USER_PASSWORD:-Sup3rSecret-Passw0rd!}"
# private signing key material should never appear in logs/responses
if grep -F -q -- "privateKey" "$BODIES_LOG" 2>/dev/null; then LEAK="${LEAK} privateKey:bodies"; fi
if [[ -z "$LEAK" ]]; then
  ok "AC-5" "no secret/password/private-key found in server.log or any response body"
else
  bad "AC-5" "leak(s):${LEAK}"
fi

# ===========================================================================
# AC-6  Tokens expire: a token past exp is rejected at the resource.
# ===========================================================================
[[ "$(chk ac6)" == "1" ]] \
  && ok "AC-6" "expired ID token rejected by Notes verifier; $(ev ac6); userinfo garbage-token -> 401 ($(ev userinfo))" \
  || bad "AC-6" "expired token not rejected ($(ev ac6))"

# ===========================================================================
# AC-7  Private keys never served: JWKS exposes public keys only.
# ===========================================================================
JWKS_PRIV=$(printf '%s' "$JWKS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const bad=(j.keys||[]).some(k=>("d" in k)||("privateKey" in k)||("p" in k)||("q" in k));process.stdout.write(bad?"PRIVATE":"PUBLIC")}catch{process.stdout.write("ERR")}})')
if [[ "$JWKS_PRIV" == "PUBLIC" ]]; then
  KTY=$(printf '%s' "$JWKS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write((j.keys[0].kty||"")+"/"+(j.keys[0].crv||j.keys[0].alg||""))})')
  ok "AC-7" "JWKS contains public params only (no d/p/q/privateKey); key=${KTY}"
else
  bad "AC-7" "JWKS exposed private material (${JWKS_PRIV})"
fi

# ===========================================================================
# AC-8  Audience/issuer enforced by the independent verifier.
# ===========================================================================
[[ "$(chk ac8)" == "1" ]] \
  && ok "AC-8" "wrong audience and wrong issuer both rejected; $(ev ac8)" \
  || bad "AC-8" "aud/iss not enforced ($(ev ac8))"

# ===========================================================================
# AC-9  Authorization code is single-use.
# ===========================================================================
[[ "$(chk ac9)" == "1" ]] \
  && ok "AC-9" "replaying the used auth code yielded no token; $(ev ac9)" \
  || bad "AC-9" "auth code was reusable ($(ev ac9))"

# ===========================================================================
# AC-10  Password safety: no endpoint returns the password or its hash.
# ===========================================================================
PW_LEAK=""
if grep -F -q -- "$TEST_USER_PASSWORD" "$BODIES_LOG" 2>/dev/null; then PW_LEAK="${PW_LEAK} cleartext-password"; fi
# any user record over the wire must omit credential fields
if grep -Eiq '"(password|passwordHash|hash|salt)"[[:space:]]*:' "$BODIES_LOG" 2>/dev/null; then PW_LEAK="${PW_LEAK} credential-field"; fi
if [[ -z "$PW_LEAK" ]]; then
  ok "AC-10" "no password/hash/credential field in any response body (signup, signin, /api/me, userinfo, token)"
else
  bad "AC-10" "found:${PW_LEAK}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
say ""
say "================ ACCEPTANCE CRITERIA ================"
for line in "${RESULTS[@]}"; do say "$line"; done
say "===================================================="
say "PASS: ${PASS}   FAIL: ${FAIL}"
[[ $FAIL -eq 0 ]] && { say "ALL CHECKS PASSED"; exit 0; } || { say "SOME CHECKS FAILED"; exit 1; }

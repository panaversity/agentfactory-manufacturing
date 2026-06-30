#!/usr/bin/env bash
#
# agent-verify.sh — boots AuthCo and checks the AGENT-identity layer
# (@better-auth/agent-auth) end-to-end via an independent agent consumer.
#
# Proves the frontier: an agent gets its OWN credential (autonomous), a human
# approves a value-constrained capability via device code (delegated), the
# constraint is enforced at execution, a destructive capability needs physical
# presence, and the agent plane never shares a credential with the human issuer.
#
# Self-contained: generates .env if missing, runs the Better Auth migration
# (which now includes the agent-auth tables), links jose for the consumer,
# starts `next dev`, runs the agent consumer, and tears the server down.
set -uo pipefail
cd "$(dirname "$0")"

PORT=3000
BASE="http://localhost:${PORT}"
AUTH="${BASE}/api/auth"
OUT="./agent-out"
SERVER_LOG="${OUT}/server.log"
PASS=0; FAIL=0

rm -rf "$OUT"; mkdir -p "$OUT"
say()  { printf '%s\n' "$*"; }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
}
trap cleanup EXIT

# --- env ---
if [[ ! -f .env ]]; then
  say "[setup] .env not found — generating one with fresh secrets."
  SEC="$(openssl rand -base64 32)"; CS="$(openssl rand -base64 32)"
  {
    echo "BETTER_AUTH_SECRET=${SEC}"
    echo "BETTER_AUTH_URL=${BASE}"
    echo "NOTES_CLIENT_ID=notes-app"
    echo "NOTES_CLIENT_SECRET=${CS}"
    echo "NOTES_REDIRECT_URI=http://localhost:4567/callback"
  } > .env
fi
set -a; . ./.env; set +a

# Link jose (used by the independent agent consumer) from the pnpm store if needed.
if [[ ! -e node_modules/jose ]]; then
  JOSE_DIR="$(find node_modules/.pnpm -maxdepth 1 -type d -name 'jose@*' | head -1)"
  if [[ -n "$JOSE_DIR" ]]; then ln -sfn "../${JOSE_DIR}/node_modules/jose" node_modules/jose; fi
fi

# Fresh schema each run (includes agentHost/agent/agentCapabilityGrant/approvalRequest).
rm -f ./sqlite.db
say "[setup] running Better Auth migration (incl. agent-auth tables)..."
npx -y @better-auth/cli@latest migrate -y >/dev/null 2>&1 || npx @better-auth/cli@latest migrate -y >"${OUT}/migrate.log" 2>&1

# --- boot ---
say "[setup] starting next dev (logs -> ${SERVER_LOG})..."
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 2
pnpm dev > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
UP=""
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "${AUTH}/ok" || curl -s -o /dev/null "${AUTH}/agent-configuration"; then UP=1; break; fi
  sleep 1
done
if [[ -z "$UP" ]]; then say "ERROR: server did not come up"; tail -20 "$SERVER_LOG"; exit 1; fi
say "[setup] server is up."
say ""

# --- run the independent agent consumer ---
say "[flow] running independent agent consumer (autonomous + delegated + webauthn)..."
node agent-consumer/consumer.mjs > "${OUT}/consumer.stdout" 2>&1 || true

# --- report ---
say ""
say "================ AGENT-IDENTITY CHECKS ================"
node -e '
const r = require("./agent-out/../agent-consumer/result.json");
const labels = {
  "A1-register":"autonomous agent registered under a dynamic host",
  "A2-autograint":"in-budget capability auto-granted (no human)",
  "A3-execute":"agent executed with its OWN self-signed credential",
  "A4-replay-rejected":"replayed jti rejected",
  "A5-forgery-rejected":"forged credential (wrong key) rejected",
  "B1-human":"human owner signed up",
  "B2-host":"human created a host they own",
  "B3-pending":"delegated agent pending + device-code issued",
  "B4-blocked-pre-approval":"capability blocked before approval",
  "B5-approved":"human approved via device-code flow",
  "B6-within-constraint":"executes within the value constraint",
  "B7-single-use":"single-use grant consumed",
  "B8-constraint-violated":"out-of-scope value rejected (constraint_violated)",
  "C1-webauthn-refused":"destructive capability refuses session-only approval",
  "C2-destructive-blocked":"destructive capability still blocked at execute",
  "D1-human-token-rejected-at-agent":"human issuer token rejected at agent endpoint",
  "D2-agent-cred-not-in-human-jwks":"agent credential not valid against human JWKS",
};
let pass=0, fail=0;
for (const [k,label] of Object.entries(labels)) {
  const okk = r.checks[k];
  console.log(`${okk?"PASS":"FAIL"}  ${k.padEnd(34)} -- ${label}${r.evidence[k]?"  ["+r.evidence[k]+"]":""}`);
  okk?pass++:fail++;
}
if (r.error) console.log("\nERROR:\n"+r.error);
console.log("======================================================");
console.log(`PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail===0?0:1);
'

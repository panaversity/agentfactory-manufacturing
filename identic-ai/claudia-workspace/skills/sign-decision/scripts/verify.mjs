// verify.mjs — verify a signature against the PUBLIC key only.
//
// Proves a decision row was signed by the owner's delegate key without ever
// touching the private key. Re-canonicalizes the payload (must byte-match what
// the signer canonicalized) and verifies the ed25519 signature.
//
// Usage:
//   node verify.mjs --payload payload.json --sig <base64>
//   echo '<payload json>' | node verify.mjs --sig <base64>
// Exit 0 = valid, exit 2 = invalid (so callers can gate on it).

import { verify as edVerify, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalBytes } from "./canonical.mjs";

const PUB_PATH = join(homedir(), ".openclaw", "keys", "identic-ai.pub");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sigB64 = arg("--sig");
if (!sigB64) {
  console.error("verify: --sig <base64> is required");
  process.exit(1);
}

let payloadRaw;
const payloadPath = arg("--payload");
if (payloadPath) {
  payloadRaw = readFileSync(payloadPath, "utf8");
} else {
  payloadRaw = readFileSync(0, "utf8");
}
payloadRaw = payloadRaw.trim();
if (!payloadRaw) {
  console.error("verify: no payload provided (--payload <file> or stdin)");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(payloadRaw);
} catch (e) {
  console.error(`verify: payload is not valid JSON: ${e.message}`);
  process.exit(1);
}

let publicKey;
try {
  publicKey = createPublicKey(readFileSync(PUB_PATH, "utf8"));
} catch (e) {
  console.error(`verify: cannot load public key from ${PUB_PATH}: ${e.message}`);
  process.exit(1);
}

const bytes = canonicalBytes(payload);
const sig = Buffer.from(sigB64, "base64");
const ok = edVerify(null, bytes, publicKey, sig);

if (ok) {
  console.log("VALID");
  process.exit(0);
} else {
  console.log("INVALID");
  process.exit(2);
}

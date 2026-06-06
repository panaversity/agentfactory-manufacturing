// sign.mjs — sign a decision payload with the owner's ed25519 private key.
//
// Reads the payload JSON from stdin, canonicalizes it (JCS), signs the
// canonical bytes with ed25519, and prints ONLY the base64 signature to stdout.
// The private key is loaded from ~/.openclaw/keys/identic-ai.pem and is never
// printed. The public fingerprint goes to stderr for the caller to record.
//
// Usage:
//   echo '{"approval_id":"apr_1","action":"approve",...}' | node sign.mjs
//   cat payload.json | node sign.mjs

import { sign as edSign, createPrivateKey, createPublicKey, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalBytes } from "./canonical.mjs";

const PRIV_PATH = join(homedir(), ".openclaw", "keys", "identic-ai.pem");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const raw = readStdin().trim();
if (!raw) {
  console.error("sign: no payload on stdin");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  console.error(`sign: stdin is not valid JSON: ${e.message}`);
  process.exit(1);
}

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(PRIV_PATH, "utf8"));
} catch (e) {
  console.error(`sign: cannot load private key from ${PRIV_PATH}: ${e.message}`);
  console.error("Run keygen.mjs first.");
  process.exit(1);
}

const bytes = canonicalBytes(payload);
const sig = edSign(null, bytes, privateKey);

// Public fingerprint to stderr so the ledger can record which key signed,
// without ever exposing the private key.
const pubDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
const fingerprint = createHash("sha256").update(pubDer).digest("hex");
console.error(`public_fingerprint=${fingerprint}`);

process.stdout.write(sig.toString("base64"));

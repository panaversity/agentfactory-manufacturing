// sign.mjs - generate the delegate's ed25519 keypair, sign an approval decision
// over RFC-8785 canonical JSON, and verify. Run: node sign.mjs <command>.
//
//   node sign.mjs keygen                  -> writes ~/.openclaw/keys/identic-ai.pem (chmod 600),
//                                            prints the public key (hex) to register
//   node sign.mjs sign '<payload-json>'   -> prints the attestation (hex signature)
//   node sign.mjs verify '<payload-json>' <sigHex> <pubHex>  -> prints VALID / INVALID
//   node sign.mjs selftest                -> sign + verify + tamper-detect, end to end
//
// Pin the @noble/ed25519 surface against the package README / Context7 before relying on it.
// Verified against @noble/ed25519@3.1.0: NAMED exports (sign, verify, getPublicKey,
// utils.randomSecretKey). Older majors shaped this differently; re-confirm per cohort.
// `npm i @noble/ed25519`.

import { sign as edSign, verify as edVerify, getPublicKey, utils, hashes } from "@noble/ed25519";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "./canonical.mjs";

// @noble/ed25519@3.x ships hash-agnostic: you MUST wire a SHA-512 before signing,
// or it throws "hashes.sha512 not set". Use Node's built-in crypto (sync).
hashes.sha512 = (...msgs) => {
  const h = createHash("sha512");
  for (const m of msgs) h.update(m);
  return new Uint8Array(h.digest());
};

const KEY_PATH = join(homedir(), ".openclaw", "keys", "identic-ai.pem");

const toHex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => Uint8Array.from(Buffer.from(h, "hex"));

function loadPriv() {
  if (!existsSync(KEY_PATH)) throw new Error(`No signing key at ${KEY_PATH}; run "node sign.mjs keygen" first.`);
  return fromHex(readFileSync(KEY_PATH, "utf8").trim());
}

function keygen() {
  const priv = utils.randomSecretKey();
  const pub = getPublicKey(priv);
  mkdirSync(join(homedir(), ".openclaw", "keys"), { recursive: true });
  writeFileSync(KEY_PATH, toHex(priv), { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  // Private key stays on disk, chmod 600, never printed. Only the public key is shown.
  console.log("public_key_hex:", toHex(pub));
  console.log(`private key written to ${KEY_PATH} (chmod 600). Never commit it; register the public key.`);
}

function sign(payloadJson) {
  const payload = JSON.parse(payloadJson);
  const bytes = new TextEncoder().encode(canonicalize(payload));
  const sig = edSign(bytes, loadPriv());
  console.log(toHex(sig));
}

function verify(payloadJson, sigHex, pubHex) {
  const bytes = new TextEncoder().encode(canonicalize(JSON.parse(payloadJson)));
  const ok = edVerify(fromHex(sigHex), bytes, fromHex(pubHex));
  console.log(ok ? "VALID" : "INVALID");
  if (!ok) process.exitCode = 1;
}

function selftest() {
  const priv = utils.randomSecretKey();
  const pub = getPublicKey(priv);
  const payload = {
    approval_id: "apr_demo",
    action: "approve",
    principal: "owner_identic_ai",
    acting_on_behalf_of: "owner_human_maya",
    decided_at: "2026-05-29T10:00:00Z",
  };
  const bytes = new TextEncoder().encode(canonicalize(payload));
  const sig = edSign(bytes, priv);
  const good = edVerify(sig, bytes, pub);
  const tampered = { ...payload, action: "reject" };
  const tamperedBytes = new TextEncoder().encode(canonicalize(tampered));
  const bad = edVerify(sig, tamperedBytes, pub);
  console.log("signed+verified:", good, "| tamper rejected:", bad === false);
  if (!good || bad) process.exitCode = 1;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "keygen") keygen();
else if (cmd === "sign") sign(args[0]);
else if (cmd === "verify") verify(args[0], args[1], args[2]);
else if (cmd === "selftest") selftest();
else {
  console.error("usage: node sign.mjs keygen | sign <payload> | verify <payload> <sigHex> <pubHex> | selftest");
  process.exitCode = 2;
}

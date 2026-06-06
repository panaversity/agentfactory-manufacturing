// keygen.mjs — generate the owner's ed25519 delegate keypair, once.
//
// Private key -> ~/.openclaw/keys/identic-ai.pem (chmod 600), NEVER printed.
// Public key  -> ~/.openclaw/keys/identic-ai.pub (PEM, safe to share).
// Prints only the public SHA-256 fingerprint and runs a sign/verify self-test.
// Refuses to overwrite an existing private key (rotation is a deliberate,
// owner-driven act, never an accident of re-running setup).
//
// Usage:
//   node keygen.mjs            # create the keypair if absent
//   node keygen.mjs --force    # overwrite (rotation; old signatures stop verifying)

import { generateKeyPairSync, sign as edSign, verify as edVerify, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_DIR = join(homedir(), ".openclaw", "keys");
const PRIV_PATH = join(KEY_DIR, "identic-ai.pem");
const PUB_PATH = join(KEY_DIR, "identic-ai.pub");

const force = process.argv.includes("--force");

if (existsSync(PRIV_PATH) && !force) {
  console.error(`Refusing to overwrite existing private key at ${PRIV_PATH}.`);
  console.error("Rotation is deliberate: re-run with --force only if you mean to retire the old key.");
  process.exit(1);
}

mkdirSync(KEY_DIR, { recursive: true });
chmodSync(KEY_DIR, 0o700);

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });

writeFileSync(PRIV_PATH, privPem, { mode: 0o600 });
chmodSync(PRIV_PATH, 0o600); // belt and suspenders against a permissive umask
writeFileSync(PUB_PATH, pubPem, { mode: 0o644 });

// Fingerprint = SHA-256 of the DER (spki) public key bytes, hex.
const pubDer = publicKey.export({ type: "spki", format: "der" });
const fingerprint = createHash("sha256").update(pubDer).digest("hex");

// Self-test: sign a probe and verify it, so we never ship a broken key.
const probe = Buffer.from("identic-ai keygen self-test", "utf8");
const sig = edSign(null, probe, privateKey); // ed25519: algorithm arg is null
const ok = edVerify(null, probe, publicKey, sig);
if (!ok) {
  console.error("FAIL: generated key failed its own sign/verify self-test");
  process.exit(1);
}

console.log("ed25519 delegate keypair created.");
console.log(`  private: ${PRIV_PATH} (chmod 600, never printed)`);
console.log(`  public:  ${PUB_PATH}`);
console.log(`  public SHA-256 fingerprint: ${fingerprint}`);
console.log("sign/verify self-test OK");

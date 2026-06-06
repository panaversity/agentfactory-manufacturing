---
name: sign-decision
description: Sign an approval decision with the owner's ed25519 delegate key over canonical JSON, so every call Claudia makes is attributable and verifiable. Use before posting or logging any approval decision.
---

# sign-decision

Every decision you make carries a signature, so it can be told apart from a call the owner made themselves and can be verified later. This skill signs the decision payload with your ed25519 private key. Public key only is ever shared; the private key never leaves the machine, is never printed, logged, or committed.

## When to use

Before you write a `governance_ledger` row or post a `paperclipApprovalDecision`. The signature goes in the ledger row's `attestation` field (and optionally the approval `decisionNote`). A decision without a verifying signature fails gate 2 and is not posted.

## The scripts (working code, ed25519 over JCS, Node stdlib only)

This skill ships executable. All four scripts are dependency-free Node ESM (`crypto`, no npm). Run them with `node`.

- **`scripts/canonical.mjs`**: RFC-8785 (JCS) canonical JSON over the decision payload. Recursive key sort by UTF-16 code unit, no insignificant whitespace, so signer and verifier byte-match. `node canonical.mjs` runs a self-test proving key order is stable. Both `sign` and `verify` import it, so they canonicalize identically by construction.
- **`scripts/keygen.mjs`**: generate the ed25519 keypair, once. Private key to `~/.openclaw/keys/identic-ai.pem` (chmod 600), public to `identic-ai.pub`. The private key is NEVER printed; it prints only the public SHA-256 fingerprint and runs a sign/verify self-test. It refuses to overwrite an existing private key (`--force` only for deliberate rotation).
- **`scripts/sign.mjs`**: read a decision payload as JSON on stdin, canonicalize it, sign the canonical bytes with the private key, print ONLY the base64 signature to stdout. The public fingerprint goes to stderr (`public_fingerprint=...`) for the ledger to record.
- **`scripts/verify.mjs`**: verify a signature against the PUBLIC key only (`--sig <base64>`, payload via `--payload <file>` or stdin). Exit 0 = valid, exit 2 = invalid, so callers gate on it.

## The decision payload

A plain object: at minimum the approval id, the action (`approve` / `reject` / `request_revision` / `surface_to_owner`), the principal (`owner_identic_ai`), who you act for, and a timestamp. Keep the field set stable; signer and verifier must agree on it exactly. `govern-queue`'s `decide.mjs` builds this payload and calls `sign.mjs` + `verify.mjs` for you on every cleared decision; the signature lands in the ledger row's `attestation_b64`.

## Hard rules

- Private key never printed, logged, copied to clipboard, or written to git. The base `.gitignore` already ignores `*.pem` and `keys/`; do not undo that.
- Public key only travels.
- Same canonicalization on signer and verifier, or signatures silently fail to verify.
- Do not invent a bespoke crypto scheme; ed25519 over canonical JSON, using Node stdlib `crypto`, is the whole design.

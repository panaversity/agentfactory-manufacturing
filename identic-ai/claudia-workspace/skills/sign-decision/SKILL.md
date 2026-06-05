---
name: sign-decision
description: Sign an approval decision with the owner's ed25519 delegate key over canonical JSON, so every call Claudia makes is attributable and verifiable. Use before posting or logging any approval decision.
---

# sign-decision

Every decision you make carries a signature, so it can be told apart from a call the owner made themselves and can be verified later. This skill signs the decision payload with your ed25519 private key. Public key only is ever shared; the private key never leaves the machine, is never printed, logged, or committed.

## When to use

Before you write a `governance_ledger` row or post a `paperclipApprovalDecision`. The signature goes in the ledger row's `attestation` field (and optionally the approval `decisionNote`). A decision without a verifying signature fails gate 2 and is not posted.

## The shape (wiring, not a finished module)

1. **Build the decision payload** as a plain object: at minimum the approval id, the action (`approve` / `reject` / `request_revision` / `surface_to_owner`), the principal (`owner_identic_ai`), who you act for, and a timestamp. Keep the field set stable; signer and verifier must agree on it exactly.

2. **Canonicalize to RFC-8785 (JCS) JSON before signing.** Sort keys, strip insignificant whitespace, so the bytes the signer sees and the bytes the verifier sees match exactly. A payload re-serialized with different key order or spacing will not verify. This is the single most common signing bug; do it the same way on both sides.

3. **Sign the canonical bytes with ed25519.** Use the platform's stdlib ed25519 (Node `crypto`, or `@noble/ed25519`; Python `cryptography`'s Ed25519PrivateKey). Load the private key from `~/.openclaw/keys/identic-ai.pem` (chmod 600) or the OS keychain, never from a literal in code or git.

4. **Emit signature + public key fingerprint.** The verifier needs only the public key, the canonical payload, and the signature. Verification is the inverse: re-canonicalize the payload, verify the signature against the public key, accept or reject.

## Hard rules

- Private key never printed, logged, copied to clipboard, or written to git. The base `.gitignore` already ignores `*.pem` and `keys/`; do not undo that.
- Public key only travels.
- Same canonicalization on signer and verifier, or signatures silently fail to verify.
- Do not invent a bespoke crypto scheme; ed25519 over canonical JSON, using stdlib, is the whole design.
- Confirm the exact stdlib call surface against current library docs before you write it; the ed25519 API differs slightly across `crypto`, `@noble/ed25519`, and `cryptography`.

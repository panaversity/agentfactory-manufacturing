---
name: sign-decision
description: Generate an ed25519 keypair for the Owner Identic AI and sign approval decisions over RFC-8785 canonical JSON, so each delegated decision carries tamper-evident, verifiable provenance that Paperclip's own audit trail does not record. Use when the delegate resolves or refuses a Paperclip approval and needs an attestation, or when setting up the delegate's signing key.
allowed-tools: Read, Write, Bash
---

# sign-decision

The Owner Identic AI ("Claudia") resolves approvals on the owner's behalf. Paperclip records a decision only as "a board user did this" (`activity_log.actor_type='user'`), unsigned, with no way to tell the human from the delegate. This skill makes each delegated decision **attested**: signed with the delegate's own ed25519 key over a canonical JSON payload, so anyone can later verify that this exact decision was made by this delegate, and detect any tampering.

This is course-authored. There is no signing MCP and no off-the-shelf signing skill that targets this shape (`wshobson/agents`'s `signed-audit-trails-recipe` is the closest published reference: ed25519 + RFC-8785 + hash-chained receipts; read it for the pattern, do not depend on it).

## When to use

- Once, to **generate the keypair** the delegate signs with.
- Every time the delegate **resolves or refuses** a Paperclip approval, to produce the `attestation` written into the `governance_ledger` row (and, optionally, into the approval's `decisionNote`).

## The two non-negotiables

1. **The private key never leaves the owner's machine and is never committed.** Write it to `~/.openclaw/keys/identic-ai.pem` with `chmod 600`, or store it in the macOS Keychain. Never print it, log it, copy it to the clipboard, or write it into git. The repo `.gitignore` ignores `*.pem` and `keys/`; do not undo that. Only the public key is shareable (register it as the delegate's verification key).
2. **Sign over RFC-8785 (JCS) canonical JSON.** Sort object keys, strip insignificant whitespace, before signing. The verifier must canonicalize the same way or the signature will not verify. Signing a `JSON.stringify` with a different key order is the most common silent failure here.

## The decision payload (what gets signed)

A stable, minimal object. Whatever fields you sign, the verifier reconstructs identically:

```json
{
  "approval_id": "apr_...",
  "action": "approve",
  "principal": "owner_identic_ai",
  "acting_on_behalf_of": "<owner-human paperclip user id>",
  "decided_at": "2026-05-29T10:00:00Z"
}
```

Keep it to the fields that define the decision. Do not include the signature itself, and do not include volatile fields (a fresh timestamp computed at verify time) that the verifier cannot reproduce.

## Recipe

Node, using `@noble/ed25519` (audited, dependency-light) and a small RFC-8785 canonicalizer. Install with `npm i @noble/ed25519`. See `sign.mjs` and `canonical.mjs` in this folder for the runnable, live-tested version. The shape, verified against `@noble/ed25519@3.1.0`:

```js
import { sign, verify, getPublicKey, utils, hashes } from "@noble/ed25519";
import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.mjs";

// v3 ships hash-agnostic: wire a SHA-512 first, or it throws "hashes.sha512 not set".
hashes.sha512 = (...m) => {
  const h = createHash("sha512");
  for (const x of m) h.update(x);
  return new Uint8Array(h.digest());
};

// keygen (once): persist priv (hex) to ~/.openclaw/keys/identic-ai.pem (chmod 600), publish pub
const priv = utils.randomSecretKey();
const pub = getPublicKey(priv);

// sign a decision
const bytes = new TextEncoder().encode(canonicalize(payload)); // RFC-8785 bytes
const sig = sign(bytes, priv); // attestation = hex(sig)

// verify (anyone, offline, with the public key)
const ok = verify(sig, bytes, pub);
```

Two facts this code learned by being run, not recalled, and that you re-confirm per cohort because the package moves: v3 uses **named exports** (`sign`/`verify`/`getPublicKey`/`utils.randomSecretKey`), not an `ed25519.*` object; and v3 is **hash-agnostic**, so you set `hashes.sha512` before any sign/verify or it throws. Confirm the current surface against the package README or Context7, then paste; do not recall it. The conceptual flow (canonicalize, sign, verify against the public key) is stable.

## Verify it works

Sign a sample payload, then verify the signature against the public key, then mutate one byte of the payload and confirm verification fails. A signing skill that does not fail on a mutated payload is not protecting anything.

## Honest framing

This proves "this decision came from this delegate's key, unchanged." It does not prove the decision was wise, and it is only as trustworthy as the key custody. The key is the credential; protecting it (and revoking it on loss, Decision 7) is the security boundary.

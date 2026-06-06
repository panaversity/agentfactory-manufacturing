---
name: governance-ledger
description: Append and query the owner's local append-only governance ledger, the parallel reasoning stream that records every decision Claudia makes (posted, surfaced, or refused) with its signature and rationale. Use after every decision and when the owner reviews the week.
---

# governance-ledger

Paperclip's own audit trail is real and immutable, but on an approval decision it only knows "a board user did this": it hardcodes `actor_type='user'` and has no signature field, so it cannot tell the owner-human from the owner's delegate. This ledger is what carries that distinction. Every decision you make writes one row here, with the attested principal and the ed25519 signature Paperclip has nowhere to store.

The ledger is a local append-only JSONL file at `~/.openclaw/governance/ledger.jsonl`: one JSON object per line, never rewritten, only appended. No database, no Neon, no network. Plain disk.

## When to use

After every decision, without exception: a cleared (`posted`) refund, a `surfaced` item you handed back to the owner, and a `refused` item that failed a gate are all equally auditable. A decision with no ledger row did not happen as far as the weekly review is concerned.

## The scripts

- **`scripts/record.mjs`**: append one row. Pipe the row as JSON on stdin (or `--row <file>`). It fills `ledger_id` and `ts` if absent, requires `approval_id`/`principal`/`action`/`disposition`, validates `disposition` is one of `posted`/`surfaced`/`refused`, and refuses to write a `dry_run: true` row to the production ledger. Prints the `ledger_id` it wrote.
- **`scripts/query.mjs`**: read and filter. `--approval <id>` for one approval, `--disposition surfaced` to see what you handed back, `--week` for a counts-and-cents summary, `--json` to pipe. Bare = a readable table.

## The row shape

```
approval_id, company_id, actor_kind=delegate, principal, action,
disposition (posted|surfaced|refused), amount_cents, decision_layer,
rationale, dry_run, public_fingerprint, attestation_b64,
canonical_payload, ledger_id, ts
```

`attestation_b64` is the ed25519 signature from `sign-decision`; `public_fingerprint` says which key signed; `canonical_payload` is the exact JCS bytes that were signed, so the row is independently verifiable later. The `govern-queue` skill calls `record.mjs` for you on each decision; call `query.mjs` yourself when the owner asks what you did.

## Hard rules

- Append only. Never rewrite or delete a row; a corrected decision is a new row (an override), not an edit.
- A `dry_run` decision never reaches this ledger. Log the intent to stdout instead; this ledger is the production record.
- The signature and fingerprint come from `sign-decision`; never fabricate them.

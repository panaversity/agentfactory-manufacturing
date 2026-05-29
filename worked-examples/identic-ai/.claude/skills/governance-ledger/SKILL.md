---
name: governance-ledger
description: Write one append-only row to the Neon governance_ledger table for every approval decision the Owner Identic AI makes, posted or refused, carrying the attested principal, the action, the confidence, the reasoning, and the ed25519 signature that Paperclip's own audit trail does not record. Use after the delegate resolves or surfaces an approval, and to query the two-principal audit story for the owner's weekly review.
allowed-tools: Read, Write, Bash
---

# governance-ledger

Paperclip's `activity_log` is real and immutable, but on an approval **decision** it only records "a board user did this" (`actor_type='user'`, no `agentId`), and it is unsigned. It cannot tell the owner-human from the owner's delegate, and it carries no provenance. This skill keeps the **parallel reasoning stream** Paperclip does not: one row per decision the Owner Identic AI made, naming the principal, the attestation from `sign-decision`, and the reasoning, joinable back to Paperclip's `activity_log` by approval id.

This is course-authored. No ledger skill targets this shape; it is the second half of the course's IP, paired with `sign-decision`.

## When to use

- After the delegate **resolves** an approval (approve / reject / request_revision): write the row that attests who decided and why.
- After the delegate **refuses to act** (an approval outside the delegated envelope, surfaced to the owner): write a `surface_to_owner` row, so the refusal is auditable too. A ledger that only records what the delegate did, not what it declined, hides the most important governance signal.

## Where it lives

A Neon Postgres table, provisioned over the Neon MCP (keyless OAuth). The schema is in `../../identic-ai/docs/governance-ledger-schema.sql` (the `governance_ledger` CREATE TABLE plus the real Paperclip tables it joins against). Create it on a Neon branch first (`prepare_database_migration` then `complete_database_migration`), never untested DDL against main. The connection string is `DATABASE_URL` in `.env`, written by the agent after provisioning, never by hand.

## Append-only discipline

The ledger is **insert-only**. Never `UPDATE` or `DELETE` a ledger row: a corrected decision is a NEW row, and an owner override sets `override_status` on a new row that references the original, it does not rewrite history. An audit trail you can edit is not an audit trail. (Paperclip's own `activity_log` is immutable for the same reason; this table mirrors that property by convention, enforced in the writer.)

## One row per decision

The columns (see the SQL for the full annotated list): `ledger_id` (PK), `approval_id` (the join key to `activity_log.entity_id`), `principal` (`owner_identic_ai`), `acting_on_behalf_of` (the owner-human's Paperclip user id), `signer_agent_id`, `action_taken` (`approve` | `reject` | `request_revision` | `surface_to_owner`), `confidence` (0.0-1.0), `layer_source` (`standing_instruction` | `derived_pattern` | `persona` | `none`), `layer_reference`, `reasoning_summary`, `attestation` (the ed25519 signature from `sign-decision`), `override_status`, `timestamp`.

## Recipe

Node, `pg` (or the Neon serverless driver `@neondatabase/serverless`). See `ledger.mjs` for the runnable writer; the shape:

```js
import { writeLedgerRow, ledgerJoin } from "./ledger.mjs";

// after a decision (the attestation comes from the sign-decision skill):
await writeLedgerRow(process.env.DATABASE_URL, {
  approval_id: "apr_...",
  principal: "owner_identic_ai",
  acting_on_behalf_of: "<owner-human user id>",
  signer_agent_id: "<delegate agent id, if registered>",
  action_taken: "approve",
  confidence: 0.93,
  layer_source: "derived_pattern",
  layer_reference: "refund-small-duplicate-charge",
  reasoning_summary:
    "Inside the delegated envelope: $42 duplicate-charge refund, 410-day account, no prior refunds. Matches Maya's fast-clear band.",
  attestation: "<hex ed25519 signature>",
});

// the owner's weekly review: what did the delegate do, and how did Paperclip record it?
const rows = await ledgerJoin(paperclipActivityRows, ledgerRows); // join by approval_id
```

Because the Neon `governance_ledger` and Paperclip's `activity_log` live in **separate** stores (Neon vs the sandbox's embedded Postgres), the join is reconstructed in the reviewer step by approval id, not a SQL `JOIN` across databases. The SQL `JOIN` in the schema comments is the conceptual shape; `ledgerJoin` is the practical one. Confirm the current `pg` / Neon driver call surface against its README or Context7 before relying on it.

## Verify it works

Provision the table on a Neon branch, write a row for a resolved approval and a row for a surfaced one, then query both back and confirm the surfaced one carries `action_taken='surface_to_owner'` with no posted decision. Then reconstruct the two-principal view: for one approval id, show the Paperclip row (`actor_type='user'`) beside the ledger row (`principal='owner_identic_ai'`) with its attestation. That side-by-side IS the lesson.

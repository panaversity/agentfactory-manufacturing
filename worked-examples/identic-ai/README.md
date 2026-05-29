# Owner Delegation with Identic AI: reference solution

The answer key for the **Owner Delegation with Identic AI** crash course. Read it after you have built the delegate yourself, or when you are stuck and want to compare. This is not your starting point; the starting point is `identic-ai/` at the repo root. This folder is excluded from the release zip.

The genuinely course-authored IP is the two skills under `.claude/skills/`. Everything else in the course (the delegate engine, the approval gates, the Paperclip wiring, the ledger store) is native OpenClaw, the official Paperclip MCP, and keyless Neon, wired rather than hand-rolled.

## The two skills

- **`sign-decision/`** ([`SKILL.md`](.claude/skills/sign-decision/SKILL.md), `canonical.mjs`, `sign.mjs`): generates the delegate's ed25519 keypair and signs each approval decision over RFC-8785 canonical JSON, so a delegated decision carries verifiable, tamper-evident provenance that Paperclip's own audit trail does not record. `sign.mjs selftest` runs sign + verify + tamper-detect end to end. Live-tested against `@noble/ed25519@3.1.0` (named exports; you must wire `hashes.sha512`).

- **`governance-ledger/`** ([`SKILL.md`](.claude/skills/governance-ledger/SKILL.md), `ledger.mjs`): writes one append-only row to the Neon `governance_ledger` table for every decision the delegate makes, posted or refused, carrying the attested principal, the reasoning, and the signature. `ledgerJoin` reconstructs the two-principal view the owner reviews weekly (Paperclip's `actor_type='user'` row beside the ledger's `principal='owner_identic_ai'` row, by approval id).

## Why the ledger is real IP, not plumbing

Verified against Paperclip v2026.525.0: the approval-decision routes hardcode `actorType:"user"` and never write an `agentId`; the `approvals` table has no `decidedByAgentId`; the official OpenClaw onboarding registers OpenClaw as an agent that is forbidden from deciding approvals. So Paperclip cannot, natively, tell the owner-human from the owner's delegate on a decision, and it stores no signature. The two skills above carry exactly that missing distinction and provenance. The schema, with the real Paperclip tables it joins against, is annotated in `../../identic-ai/docs/governance-ledger-schema.sql`.

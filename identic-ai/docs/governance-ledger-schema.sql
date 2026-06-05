-- governance-ledger-schema.sql
-- The data shapes Course 8's lab works with.
--
-- IMPORTANT: Course 8 does NOT modify Paperclip's own schema. Paperclip owns
-- `activity_log`, `approvals`, `agents`, `agent_api_keys`, and `principal_permission_grants`
-- already (re-verified against v2026.525.0). Course 8 adds exactly ONE table of its own:
-- `governance_ledger`, the Identic AI's parallel reasoning stream. Everything else below is REAL
-- Paperclip schema, shown read-only so you know what you JOIN against.
--
-- Where the ledger lives: the agent provisions a Neon Postgres over the Neon MCP and creates
-- `governance_ledger` there (the `governance-ledger` skill you build in Act 2 writes rows to it).
-- Paperclip's own tables live in the local sandbox's embedded Postgres; the JOIN below is
-- conceptual (the two stores are separate), reconstructed by approval id when the owner reviews.

-- =========================================================================
-- REAL PAPERCLIP TABLES (read-only reference: Paperclip owns these, do not alter them)
-- Verified live against Paperclip 2026.525.0.
-- =========================================================================

-- activity_log: Paperclip's universal who-did-what record. One row per recorded action.
-- This is the table your governance_ledger JOINs against by the approval id.
-- VERBATIM columns from Paperclip 2026.525.0:
--   id           uuid         PK, default gen_random_uuid()
--   company_id   uuid         NOT NULL
--   actor_type   text         NOT NULL, default 'system'   -- intended values: 'user' | 'agent' | 'system' (app-enforced, no DB enum)
--   actor_id     text         NOT NULL                      -- user id (e.g. 'local-board') or agent uuid
--   action       text         NOT NULL                      -- e.g. 'approval.approved', 'approval.rejected'
--   entity_type  text         NOT NULL                      -- e.g. 'approval'
--   entity_id    text         NOT NULL                      -- e.g. the approval id
--   agent_id     uuid         NULL                          -- set when actor_type = 'agent'
--   details      jsonb        NULL                          -- e.g. { type, linkedIssueIds, requestedByAgentId }
--   created_at   timestamptz  NOT NULL, default now()
--   run_id       uuid         NULL                          -- the heartbeat run, when applicable
-- IMPORTANT, verified against Paperclip 2026.525.0: the approval-decision routes
-- (POST /api/approvals/{id}/approve|reject|request-revision) are BOARD-gated. They are
-- driven with a board credential, so the activity_log row they write is ALWAYS
-- actor_type='user' (agent_id=null), whether the human or the Identic AI made the call.
-- Paperclip does NOT natively attribute an approval decision to an agent principal.
-- actor_type='agent' rows are real, but only for issue / heartbeat / run activity.
-- The owner-human vs owner-identic-ai distinction for APPROVALS therefore lives in
-- governance_ledger (below), not in activity_log. That is what this table is for.

-- approvals: a decision record, NOT a state machine. Approving does not change the linked issue.
--   id, company_id, type, requested_by_agent_id, requested_by_user_id, status (default 'pending'),
--   payload jsonb, decision_note, decided_by_user_id, decided_at, created_at, updated_at
-- type enum (server-validated): 'hire_agent' | 'approve_ceo_strategy' | 'budget_override_required' | 'request_board_approval'
-- status: 'pending' -> { 'approved' | 'rejected' | 'revision_requested' }; 'revision_requested' -> resubmit -> 'pending'

-- The Identic AI as a Paperclip principal (full-implementation track anchors, all real Paperclip tables):
--   agents                       -- the agent registry; the Identic AI is registered here
--   agent_api_keys               -- { id, agent_id, company_id, name, key_hash, last_used_at, revoked_at } (revoke here for Decision 7)
--   principal_permission_grants  -- { company_id, principal_type, principal_id, permission_key, scope jsonb, granted_by_user_id }
--                                --   the delegated envelope lives in `scope` (jsonb); Paperclip has NO native signature field

-- =========================================================================
-- COURSE 8's OWN TABLE (you create this; it is additive, it does not touch Paperclip's schema)
-- =========================================================================

-- governance_ledger: the Identic AI's parallel reasoning stream. One row per decision the
-- Identic AI made (autonomous OR surfaced). Joinable to Paperclip's activity_log by approval_id.
-- This is the audit stream the owner reviews weekly.
CREATE TABLE IF NOT EXISTS governance_ledger (
  ledger_id            TEXT PRIMARY KEY,
  approval_id          TEXT NOT NULL,                 -- the Paperclip approval id (activity_log.entity_id / approvals.id)
  principal            TEXT NOT NULL,                 -- 'owner_identic_ai'
  acting_on_behalf_of  TEXT NOT NULL,                 -- the owner-human's Paperclip user id
  signer_agent_id      TEXT,                          -- the Identic AI's registered Paperclip agent id
  action_taken         TEXT NOT NULL,                 -- 'approve' | 'reject' | 'request_revision' | 'surface_to_owner'
  confidence           REAL,                          -- 0.0-1.0, the AI's confidence in the decision
  layer_source         TEXT,                          -- 'standing_instruction' | 'derived_pattern' | 'persona' | 'none'
  layer_reference      TEXT,                          -- the specific instruction/pattern id used
  reasoning_summary    TEXT,                          -- one-paragraph human-readable rationale
  attestation          TEXT,                          -- the ed25519 signature over the decision payload (your own attestation; Paperclip has no signature field, so you carry it here and, optionally, in the approval decision_note)
  override_status      TEXT,                          -- NULL, or 'overridden_by_owner' if the owner later reversed it
  timestamp            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_governance_ledger_approval ON governance_ledger (approval_id);

-- Reconstructing "what did the Identic AI do, and did Paperclip record it the same way":
-- The two stores are SEPARATE (governance_ledger in Neon, activity_log in the sandbox's
-- Postgres), so reconcile by approval id app-side with two queries, not one cross-DB JOIN:
--   1) in Paperclip: the approval decisions and who the actor was
--        SELECT entity_id, actor_type, actor_id, action, created_at
--        FROM activity_log WHERE action LIKE 'approval.%';
--   2) in Neon: the governance rows for those approval ids
--        SELECT * FROM governance_ledger WHERE approval_id = ANY($1);  -- ids from step 1
-- The activity_log row shows actor_type='user' (a board action); the governance_ledger row
-- is what records that the decision was the Identic AI's (principal='owner_identic_ai') with its
-- attestation and reasoning. The two together are the full audit story.

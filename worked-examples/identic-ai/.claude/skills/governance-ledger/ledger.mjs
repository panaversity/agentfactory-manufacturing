// ledger.mjs - append-only writer for the Neon governance_ledger table, plus the
// two-principal join the owner reviews. Insert-only: never UPDATE/DELETE a row.
//
// Uses the Neon serverless driver (@neondatabase/serverless), which speaks Postgres
// over HTTP/WebSocket and suits an MCP-provisioned Neon. `npm i @neondatabase/serverless`.
// (Swap to node-postgres `pg` if you prefer a direct TCP connection; same SQL.)
// Confirm the driver's current call surface against its README / Context7 before relying on it.
//
//   node ledger.mjs init                 -> create the table (idempotent; prefer a Neon branch + migration)
//   node ledger.mjs write '<row-json>'   -> insert one decision row
//   node ledger.mjs list <approval_id>   -> read rows back for one approval

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const REQUIRED = ["approval_id", "principal", "acting_on_behalf_of", "action_taken"];
const ACTIONS = new Set(["approve", "reject", "request_revision", "surface_to_owner"]);

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS governance_ledger (
  ledger_id            TEXT PRIMARY KEY,
  approval_id          TEXT NOT NULL,
  principal            TEXT NOT NULL,
  acting_on_behalf_of  TEXT NOT NULL,
  signer_agent_id      TEXT,
  action_taken         TEXT NOT NULL,
  confidence           REAL,
  layer_source         TEXT,
  layer_reference      TEXT,
  reasoning_summary    TEXT,
  attestation          TEXT,
  override_status      TEXT,
  timestamp            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_governance_ledger_approval ON governance_ledger (approval_id);
`;

export async function initLedger(databaseUrl) {
  const sql = neon(databaseUrl);
  // The driver runs one statement per call; split the DDL.
  for (const stmt of CREATE_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await sql.query(stmt);
  }
}

export async function writeLedgerRow(databaseUrl, row) {
  for (const k of REQUIRED) {
    if (!row[k]) throw new Error(`governance_ledger row missing required field: ${k}`);
  }
  if (!ACTIONS.has(row.action_taken)) {
    throw new Error(`action_taken must be one of ${[...ACTIONS].join(", ")}`);
  }
  const sql = neon(databaseUrl);
  const ledger_id = row.ledger_id ?? `gl_${randomUUID()}`;
  const timestamp = row.timestamp ?? new Date().toISOString();
  // Parameterized insert; insert-only, never an UPDATE.
  await sql.query(
    `INSERT INTO governance_ledger
       (ledger_id, approval_id, principal, acting_on_behalf_of, signer_agent_id,
        action_taken, confidence, layer_source, layer_reference, reasoning_summary,
        attestation, override_status, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      ledger_id, row.approval_id, row.principal, row.acting_on_behalf_of,
      row.signer_agent_id ?? null, row.action_taken, row.confidence ?? null,
      row.layer_source ?? null, row.layer_reference ?? null, row.reasoning_summary ?? null,
      row.attestation ?? null, row.override_status ?? null, timestamp,
    ],
  );
  return ledger_id;
}

export async function listForApproval(databaseUrl, approvalId) {
  const sql = neon(databaseUrl);
  const { rows } = await sql.query(
    `SELECT * FROM governance_ledger WHERE approval_id = $1 ORDER BY timestamp`,
    [approvalId],
  );
  return rows;
}

// The two-principal view: pair Paperclip activity_log rows (actor_type='user', from the
// sandbox) with governance_ledger rows (principal='owner_identic_ai', from Neon) by approval id.
// Reconstructed in-process because the two stores are separate databases.
export function ledgerJoin(activityRows, ledgerRows) {
  const byApproval = new Map();
  for (const a of activityRows) {
    const id = a.entity_id ?? a.approval_id;
    if (!byApproval.has(id)) byApproval.set(id, { approval_id: id, paperclip: a, ledger: [] });
    else byApproval.get(id).paperclip = a;
  }
  for (const l of ledgerRows) {
    if (!byApproval.has(l.approval_id)) byApproval.set(l.approval_id, { approval_id: l.approval_id, paperclip: null, ledger: [] });
    byApproval.get(l.approval_id).ledger.push(l);
  }
  return [...byApproval.values()];
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (cmd && !url) { console.error("DATABASE_URL not set"); process.exit(2); }
  if (cmd === "init") await initLedger(url).then(() => console.log("governance_ledger ready"));
  else if (cmd === "write") await writeLedgerRow(url, JSON.parse(arg)).then((id) => console.log("wrote", id));
  else if (cmd === "list") console.log(JSON.stringify(await listForApproval(url, arg), null, 2));
  else console.error("usage: node ledger.mjs init | write <row-json> | list <approval_id>");
}

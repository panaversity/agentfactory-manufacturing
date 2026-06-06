// query.mjs — read and filter the local governance ledger.
//
// The ledger is ~/.openclaw/governance/ledger.jsonl (append-only JSONL).
//
// Usage:
//   node query.mjs                          # all rows, pretty
//   node query.mjs --approval <id>          # rows for one approval id
//   node query.mjs --disposition surfaced   # rows with a given disposition
//   node query.mjs --week                    # weekly summary (counts + cents)
//   node query.mjs --json                    # raw JSON array (for piping)

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LEDGER_PATH = join(homedir(), ".openclaw", "governance", "ledger.jsonl");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

if (!existsSync(LEDGER_PATH)) {
  console.error(`query: no ledger at ${LEDGER_PATH} yet (no decisions recorded)`);
  process.exit(0);
}

const rows = readFileSync(LEDGER_PATH, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      console.error(`query: skipping malformed line ${i + 1}: ${e.message}`);
      return null;
    }
  })
  .filter(Boolean);

let out = rows;

const approval = arg("--approval");
if (approval) out = out.filter((r) => r.approval_id === approval);

const disposition = arg("--disposition");
if (disposition) out = out.filter((r) => r.disposition === disposition);

if (has("--week")) {
  const summary = {
    total: out.length,
    posted: out.filter((r) => r.disposition === "posted").length,
    surfaced: out.filter((r) => r.disposition === "surfaced").length,
    refused: out.filter((r) => r.disposition === "refused").length,
    posted_cents: out
      .filter((r) => r.disposition === "posted")
      .reduce((s, r) => s + (Number(r.amount_cents) || 0), 0),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (has("--json")) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (out.length === 0) {
  console.log("(no matching rows)");
  process.exit(0);
}

for (const r of out) {
  const amt = r.amount_cents != null ? `$${(r.amount_cents / 100).toFixed(2)}` : "-";
  console.log(
    `${r.ts}  ${r.disposition.toUpperCase().padEnd(8)} ${r.approval_id.padEnd(14)} ${(r.action || "").padEnd(8)} ${amt.padStart(10)}  ${r.rationale || ""}`
  );
}

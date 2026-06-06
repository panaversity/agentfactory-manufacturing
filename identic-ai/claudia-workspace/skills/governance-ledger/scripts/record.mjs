// record.mjs — append ONE decision row to the local append-only ledger.
//
// Ledger lives at ~/.openclaw/governance/ledger.jsonl (one JSON object per line,
// never rewritten, only appended). This is the parallel reasoning stream that
// Paperclip's own activity_log cannot record: it carries the attested principal
// (human vs delegate) and the signature Paperclip has no field for.
//
// Reads the row as JSON from stdin (or --row <file>) and appends it with a
// generated ledger_id + ts if absent. Prints the ledger_id it wrote.
//
// Usage:
//   echo '{"approval_id":"apr_1","disposition":"posted",...}' | node record.mjs
//   node record.mjs --row row.json

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const LEDGER_DIR = join(homedir(), ".openclaw", "governance");
const LEDGER_PATH = join(LEDGER_DIR, "ledger.jsonl");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let raw;
const rowPath = arg("--row");
if (rowPath) {
  raw = readFileSync(rowPath, "utf8");
} else {
  raw = readFileSync(0, "utf8");
}
raw = raw.trim();
if (!raw) {
  console.error("record: no row on stdin (or --row <file>)");
  process.exit(1);
}

let row;
try {
  row = JSON.parse(raw);
} catch (e) {
  console.error(`record: row is not valid JSON: ${e.message}`);
  process.exit(1);
}

// Required fields the reviewer relies on. We do not silently accept a row
// missing its disposition or approval id; that would make the ledger lie.
const required = ["approval_id", "principal", "action", "disposition"];
for (const f of required) {
  if (row[f] === undefined || row[f] === null || row[f] === "") {
    console.error(`record: row is missing required field "${f}"`);
    process.exit(1);
  }
}

const valid = new Set(["posted", "surfaced", "refused"]);
if (!valid.has(row.disposition)) {
  console.error(`record: disposition must be one of posted|surfaced|refused (got "${row.disposition}")`);
  process.exit(1);
}

if (!row.ledger_id) row.ledger_id = randomUUID();
if (!row.ts) row.ts = new Date().toISOString();
if (!row.actor_kind) row.actor_kind = "delegate";

// A dry_run row never touches the production ledger; the caller should not send
// one here, but we refuse it as a backstop so dry-run intent never leaks in.
if (row.dry_run === true) {
  console.error("record: refusing to write a dry_run row to the production ledger");
  process.exit(2);
}

mkdirSync(LEDGER_DIR, { recursive: true });
appendFileSync(LEDGER_PATH, JSON.stringify(row) + "\n", "utf8");

console.log(row.ledger_id);

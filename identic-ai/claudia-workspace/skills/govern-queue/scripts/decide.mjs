// decide.mjs — Claudia's autonomous act loop AND the hard backstop.
//
// This is her hands and her guardrail in one place. The LLM decides WHAT to do;
// this script re-validates every act against the delegated envelope IN CODE
// before anything is posted. Even if the LLM is told to clear an out-of-envelope
// item, this script refuses to post it. The envelope check here is independent
// of the LLM's reasoning — that is the whole point of a backstop.
//
// Modes:
//   node decide.mjs --scan                 # every PENDING approval, decide each, then brief the owner
//   node decide.mjs --approval <id>        # one approval by id
//   node decide.mjs --brief-only           # compose + send a brief from the ledger, decide nothing
//   node decide.mjs --selfcheck            # prove the backstop refuses out-of-envelope
//
// The brief is the chief-of-staff payoff: after a --scan pass she does not just
// govern the queue, she ALSO pushes the owner a short plain-language summary of
// the pass (cleared N for $X, M need you with the titles, the company in a line).
// --brief-only sends that summary without re-deciding, so a standing daily-brief
// cron can call it on its own schedule.
//
// Disposition per item:
//   posted    — inside the envelope, not dry_run: signed + posted to the board + ledger row
//   surfaced  — always-surface (hire/termination/policy) OR outside the envelope: ledger row, owner messaged
//   refused   — a gate failed (no/again-revoked key, signature mismatch): ledger row, nothing posted
//   (dry_run) — inside the envelope but dry_run true: intent logged to stdout, NOTHING written/posted
//
// Env:
//   PAPERCLIP_API_URL   bare host of the local sandbox, e.g. http://127.0.0.1:3100
//                       (this script appends /api itself)
//   IDENTIC_COMPANY_ID  optional override; otherwise read from the envelope's company_id
//   IDENTIC_OWNER_CHANNEL  optional: a file path to append owner messages to
//                          (stands in for the paired chat channel in the sandbox)

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIGN_DIR = join(HERE, "..", "..", "sign-decision", "scripts");
const LEDGER_DIR = join(HERE, "..", "..", "governance-ledger", "scripts");

const ENVELOPE_PATH = join(homedir(), ".openclaw", "governance", "delegated-envelope.json");

const API_BASE = (process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");

function log(...a) {
  console.log(...a);
}

// ---- envelope --------------------------------------------------------------

function loadEnvelope() {
  if (!existsSync(ENVELOPE_PATH)) {
    console.error(`decide: no delegated envelope at ${ENVELOPE_PATH}. Setup must copy it there.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(ENVELOPE_PATH, "utf8"));
}

// ---- paperclip HTTP --------------------------------------------------------

async function pcGet(path) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { "content-type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function pcPost(path, body) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function companyId(env) {
  return process.env.IDENTIC_COMPANY_ID || env.company_id;
}

async function listPending(env) {
  const cid = companyId(env);
  if (!cid) throw new Error("decide: no company_id (envelope.company_id or IDENTIC_COMPANY_ID)");
  const all = await pcGet(`/companies/${cid}/approvals`);
  const arr = Array.isArray(all) ? all : all?.approvals || [];
  return arr.filter((a) => (a.status || a.state) === "pending");
}

async function getApproval(env, id) {
  const cid = companyId(env);
  // Per-company list is the reliable read; fall back to filtering it by id.
  const all = await pcGet(`/companies/${cid}/approvals`);
  const arr = Array.isArray(all) ? all : all?.approvals || [];
  return arr.find((a) => a.id === id);
}

// Board decision routes (board-gated; sandbox is local-trusted so no key).
async function postDecision(id, action, note) {
  const route =
    action === "approve" ? "approve" : action === "reject" ? "reject" : "request-revision";
  return pcPost(`/approvals/${id}/${route}`, { decisionNote: note });
}

// ---- signing + ledger via the sibling skills -------------------------------

function signPayload(payload) {
  const r = spawnSync("node", [join(SIGN_DIR, "sign.mjs")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || "").trim() };
  }
  const fpMatch = (r.stderr || "").match(/public_fingerprint=([0-9a-f]+)/);
  return {
    ok: true,
    signature: (r.stdout || "").trim(),
    fingerprint: fpMatch ? fpMatch[1] : null,
  };
}

function verifyPayload(payload, signature) {
  const r = spawnSync("node", [join(SIGN_DIR, "verify.mjs"), "--sig", signature], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return r.status === 0;
}

function recordRow(row) {
  const r = spawnSync("node", [join(LEDGER_DIR, "record.mjs")], {
    input: JSON.stringify(row),
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`decide: ledger write failed: ${(r.stderr || "").trim()}`);
    return null;
  }
  return (r.stdout || "").trim();
}

function messageOwner(text) {
  const channel = process.env.IDENTIC_OWNER_CHANNEL;
  if (channel) {
    appendFileSync(channel, text + "\n", "utf8");
  }
  log(`  -> OWNER: ${text}`);
}

// ---- the wake brief (the chief-of-staff payoff) ----------------------------
//
// composeBrief turns THIS pass's results into one short, plain, owner-facing
// line: what she cleared (count + dollars), what needs the owner (count + the
// actual titles/amounts), what she refused, and the company in a sentence. It
// is a real function of the pass tally + the items she surfaced, never a canned
// string: change the pass and the brief changes with it. messageOwner pushes it
// to the paired chat channel, the same path a surfaced item goes out on.

function dollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

// A short, human label for a surfaced item, drawn from its real fields so the
// brief names what it actually is (a hire, an over-limit refund) not just an id.
function briefTitle(item) {
  const a = item.approval || {};
  const p = a.payload || {};
  const explicit = a.title || p.title || p.summary;
  if (explicit) return String(explicit);
  const type = a.type || "approval";
  if (type === "hire_agent") {
    const role = p.role || p.title || p.language || p.skill;
    return role ? `hire (${role})` : "hire";
  }
  if (type === "terminate_agent") return "termination";
  if (type === "approve_ceo_strategy") return "CEO strategy";
  const amt = p.amount_cents ?? p.amountCents;
  if (p.kind === "refund" || type === "request_board_approval") {
    return amt != null ? `${dollars(amt)} refund` : "refund";
  }
  if (p.kind === "budget_override" || type === "budget_override_required") {
    const pct = p.requested_overage_pct ?? p.requestedOveragePct;
    return pct != null ? `budget override (${pct}%)` : "budget override";
  }
  return type.replace(/_/g, " ");
}

// One-line read on company health from the pass shape. Honest and terse: only
// claims "healthy" when nothing was refused and the surfaced load is light.
function companyState(tally, surfacedCount) {
  if (tally.refused > 0) return "A few items hit the rails and were refused; worth a look.";
  if (surfacedCount === 0) return "Nothing needs you. Company looks healthy.";
  if (surfacedCount <= 3) return "Routine handled; a couple of calls are yours. Company looks healthy.";
  return "Routine handled; a handful need your eye.";
}

// Compose the wake brief. `tally` is the pass dispositions; `surfacedItems` is
// the list of items she surfaced this pass (each { approval, reason, amount_cents }).
function composeBrief(tally, surfacedItems, env) {
  const clearedCents = (surfacedItems.__clearedCents) || 0;
  const cleared = tally.posted || 0;
  const surfaced = surfacedItems.length;
  const refused = tally.refused || 0;

  const parts = [];
  if (cleared > 0) {
    parts.push(`cleared ${cleared} routine (${dollars(clearedCents)})`);
  } else {
    parts.push("cleared 0 routine");
  }

  if (surfaced > 0) {
    const titles = surfacedItems.map(briefTitle).join("; ");
    parts.push(`${surfaced} need you: ${titles}`);
  } else {
    parts.push("nothing needs you");
  }

  if (refused > 0) parts.push(`${refused} refused at the rails`);

  const dry = env.dry_run === true ? " [dry-run: nothing was actually posted]" : "";
  return `Heartbeat brief: ${parts.join(", ")}. ${companyState(tally, surfaced)}${dry}`;
}

// ---- the envelope classifier (the HARD BACKSTOP) ---------------------------
//
// Returns { decision: 'auto'|'surface', reason, action }.
// 'auto' ONLY when the item matches an auto_resolve rule AND passes every
// require clause AND is not an always-surface kind. Everything else surfaces.
// This function is the independent re-validation: it does not trust any caller
// claim that an item is clearable.

function classify(approval, env) {
  const type = approval.type;
  const payload = approval.payload || {};

  // Always-surface kinds, regardless of amount.
  const alwaysSurfaceTypes = new Set(["hire_agent", "approve_ceo_strategy", "terminate_agent"]);
  if (alwaysSurfaceTypes.has(type)) {
    return { decision: "surface", reason: `always-surface type (${type})`, action: "surface_to_owner" };
  }

  // Refunds: domain refunds are posted to Paperclip as request_board_approval
  // with the refund context in payload.
  if (type === "request_board_approval" || payload.kind === "refund") {
    const rule = (env.auto_resolve || []).find((r) => r.type === "refund");
    if (!rule) return { decision: "surface", reason: "no refund auto_resolve rule", action: "surface_to_owner" };

    const amount = Number(payload.amount_cents ?? payload.amountCents ?? 0);
    const ageDays = Number(payload.account_age_days ?? payload.accountAgeDays ?? 0);
    const priors = Number(payload.prior_refunds_6mo ?? payload.priorRefunds6mo ?? 0);

    if (amount > Number(rule.max_amount_cents)) {
      return {
        decision: "surface",
        reason: `refund $${(amount / 100).toFixed(2)} over ceiling $${(rule.max_amount_cents / 100).toFixed(2)}`,
        action: "surface_to_owner",
      };
    }
    const req = rule.require || {};
    if (req.min_account_age_days != null && ageDays < Number(req.min_account_age_days)) {
      return {
        decision: "surface",
        reason: `account age ${ageDays}d under min ${req.min_account_age_days}d`,
        action: "surface_to_owner",
      };
    }
    if (req.prior_refunds_6mo_max != null && priors > Number(req.prior_refunds_6mo_max)) {
      return {
        decision: "surface",
        reason: `${priors} prior refunds in 6mo over max ${req.prior_refunds_6mo_max}`,
        action: "surface_to_owner",
      };
    }
    return {
      decision: "auto",
      reason: `refund $${(amount / 100).toFixed(2)} inside envelope (age ${ageDays}d, ${priors} priors)`,
      action: rule.action || "approve",
      amount_cents: amount,
    };
  }

  // Budget overrides.
  if (type === "budget_override_required" || payload.kind === "budget_override") {
    const rule = (env.auto_resolve || []).find((r) => r.type === "budget_override");
    if (!rule) return { decision: "surface", reason: "no budget_override auto_resolve rule", action: "surface_to_owner" };
    const pct = Number(payload.requested_overage_pct ?? payload.requestedOveragePct ?? 9999);
    if (pct > Number(rule.max_overage_pct)) {
      return {
        decision: "surface",
        reason: `overage ${pct}% over max ${rule.max_overage_pct}%`,
        action: "surface_to_owner",
      };
    }
    return {
      decision: "auto",
      reason: `budget override ${pct}% inside envelope`,
      action: rule.action || "approve",
      amount_cents: 0,
    };
  }

  // Anything unmatched surfaces.
  return { decision: "surface", reason: `unmatched type (${type})`, action: "surface_to_owner" };
}

// ---- act on one approval ---------------------------------------------------

async function act(approval, env) {
  const id = approval.id;
  const cls = classify(approval, env);
  log(`\n[${id}] type=${approval.type} -> ${cls.decision}: ${cls.reason}`);

  const basePayload = {
    approval_id: id,
    company_id: companyId(env),
    principal: env.principal,
    acting_on_behalf_of: env.acting_on_behalf_of,
    action: cls.action,
    ts: new Date().toISOString(),
  };

  // ---- SURFACE path --------------------------------------------------------
  if (cls.decision === "surface") {
    messageOwner(`Approval ${id} (${approval.type}) is yours: ${cls.reason}. Recommendation: review.`);
    recordRow({
      approval_id: id,
      company_id: companyId(env),
      actor_kind: "delegate",
      principal: env.principal,
      action: "surface_to_owner",
      disposition: "surfaced",
      amount_cents: cls.amount_cents ?? null,
      decision_layer: "standing_instruction",
      rationale: cls.reason,
      dry_run: false,
      public_fingerprint: null,
      attestation_b64: null,
      canonical_payload: null,
    });
    return { disposition: "surfaced", approval, reason: cls.reason, amount_cents: cls.amount_cents ?? null };
  }

  // ---- AUTO path: re-validate, sign, gate, then post -----------------------

  // HARD BACKSTOP re-assertion: re-run the classifier result; if anything but
  // 'auto', refuse. (Belt and suspenders against a caller mutating state.)
  if (cls.decision !== "auto") {
    log(`  BACKSTOP: refusing non-auto item`);
    return { disposition: "refused", approval, reason: cls.reason, amount_cents: cls.amount_cents ?? null };
  }

  // Gate 2 prep: sign the canonical decision payload.
  const signed = signPayload(basePayload);
  if (!signed.ok) {
    log(`  GATE FAIL (sign): ${signed.error}`);
    recordRow({
      approval_id: id, company_id: companyId(env), actor_kind: "delegate",
      principal: env.principal, action: cls.action, disposition: "refused",
      amount_cents: cls.amount_cents ?? null, decision_layer: "gate",
      rationale: `signing gate failed: ${signed.error}`, dry_run: false,
      public_fingerprint: null, attestation_b64: null, canonical_payload: null,
    });
    return { disposition: "refused", approval, reason: `signing gate failed`, amount_cents: cls.amount_cents ?? null };
  }

  // Gate 2 verify: signature must verify against the public key.
  if (!verifyPayload(basePayload, signed.signature)) {
    log(`  GATE FAIL (verify): signature did not verify`);
    recordRow({
      approval_id: id, company_id: companyId(env), actor_kind: "delegate",
      principal: env.principal, action: cls.action, disposition: "refused",
      amount_cents: cls.amount_cents ?? null, decision_layer: "gate",
      rationale: "signature did not verify against public key", dry_run: false,
      public_fingerprint: signed.fingerprint, attestation_b64: null, canonical_payload: null,
    });
    return { disposition: "refused", approval, reason: "signature did not verify", amount_cents: cls.amount_cents ?? null };
  }

  // dry_run: log intent, post NOTHING, write NOTHING to the production ledger.
  if (env.dry_run === true) {
    log(`  DRY-RUN: would ${cls.action} ${id} (${cls.reason}). Nothing posted, nothing logged.`);
    return { disposition: "dry_run", approval, reason: cls.reason, amount_cents: cls.amount_cents ?? null };
  }

  // Post the decision via the board path.
  try {
    await postDecision(id, cls.action, `Auto-cleared by ${env.principal}: ${cls.reason}`);
  } catch (e) {
    log(`  POST FAILED: ${e.message}`);
    recordRow({
      approval_id: id, company_id: companyId(env), actor_kind: "delegate",
      principal: env.principal, action: cls.action, disposition: "refused",
      amount_cents: cls.amount_cents ?? null, decision_layer: "gate",
      rationale: `board post failed: ${e.message}`, dry_run: false,
      public_fingerprint: signed.fingerprint, attestation_b64: signed.signature, canonical_payload: null,
    });
    return { disposition: "refused", approval, reason: `board post failed`, amount_cents: cls.amount_cents ?? null };
  }

  const ledgerId = recordRow({
    approval_id: id, company_id: companyId(env), actor_kind: "delegate",
    principal: env.principal, action: cls.action, disposition: "posted",
    amount_cents: cls.amount_cents ?? null, decision_layer: "standing_instruction",
    rationale: cls.reason, dry_run: false,
    public_fingerprint: signed.fingerprint, attestation_b64: signed.signature,
    canonical_payload: JSON.stringify(basePayload),
  });
  log(`  POSTED + signed + logged (ledger ${ledgerId})`);
  return { disposition: "posted", approval, reason: cls.reason, amount_cents: cls.amount_cents ?? null };
}

// ---- selfcheck: prove the backstop refuses out-of-envelope -----------------

function selfcheck(env) {
  const cases = [
    { name: "in-envelope refund", a: { id: "sc1", type: "request_board_approval", payload: { kind: "refund", amount_cents: 50000, account_age_days: 400, prior_refunds_6mo: 0 } }, want: "auto" },
    { name: "over-ceiling refund", a: { id: "sc2", type: "request_board_approval", payload: { kind: "refund", amount_cents: 500000, account_age_days: 400, prior_refunds_6mo: 0 } }, want: "surface" },
    { name: "young-account refund", a: { id: "sc3", type: "request_board_approval", payload: { kind: "refund", amount_cents: 50000, account_age_days: 30, prior_refunds_6mo: 0 } }, want: "surface" },
    { name: "prior-refund refund", a: { id: "sc4", type: "request_board_approval", payload: { kind: "refund", amount_cents: 50000, account_age_days: 400, prior_refunds_6mo: 2 } }, want: "surface" },
    { name: "hire", a: { id: "sc5", type: "hire_agent", payload: {} }, want: "surface" },
    { name: "big budget override", a: { id: "sc6", type: "budget_override_required", payload: { requested_overage_pct: 45 } }, want: "surface" },
    { name: "small budget override", a: { id: "sc7", type: "budget_override_required", payload: { requested_overage_pct: 10 } }, want: "auto" },
  ];
  let pass = 0;
  for (const c of cases) {
    const got = classify(c.a, env).decision;
    const ok = got === c.want;
    if (ok) pass++;
    log(`  [${ok ? "OK" : "FAIL"}] ${c.name}: want ${c.want}, got ${got}`);
  }
  log(`\nselfcheck: ${pass}/${cases.length} passed`);
  if (pass !== cases.length) process.exit(2);
  log("BACKSTOP PROVEN: out-of-envelope items (over-ceiling, young account, priors, hires, big overrides) all surface, never auto.");
}

// ---- main ------------------------------------------------------------------

async function main() {
  const env = loadEnvelope();

  if (process.argv.includes("--selfcheck")) {
    selfcheck(env);
    return;
  }

  const idArg = (() => {
    const i = process.argv.indexOf("--approval");
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  if (idArg) {
    const a = await getApproval(env, idArg);
    if (!a) {
      console.error(`decide: approval ${idArg} not found or not pending`);
      process.exit(1);
    }
    if ((a.status || a.state) !== "pending") {
      log(`approval ${idArg} is no longer pending (${a.status}); skipping`);
      return;
    }
    await act(a, env);
    return;
  }

  if (process.argv.includes("--scan")) {
    const pending = await listPending(env);
    log(`scan: ${pending.length} pending approvals for company ${companyId(env)} (dry_run=${env.dry_run === true})`);
    const tally = { posted: 0, surfaced: 0, refused: 0, dry_run: 0 };
    const surfacedItems = [];
    let clearedCents = 0;
    for (const a of pending) {
      const r = await act(a, env);
      tally[r.disposition] = (tally[r.disposition] || 0) + 1;
      if (r.disposition === "surfaced") surfacedItems.push(r);
      if (r.disposition === "posted") clearedCents += Number(r.amount_cents || 0);
    }
    log(`\nscan complete: ${JSON.stringify(tally)}`);

    // The brief: after governing the queue, push the owner a one-line summary of
    // THIS pass. Composed from the real tally + the items she surfaced, then sent
    // on the same owner channel surfaced items go out on.
    surfacedItems.__clearedCents = clearedCents;
    const brief = composeBrief(tally, surfacedItems, env);
    messageOwner(brief);
    return;
  }

  if (process.argv.includes("--brief-only")) {
    // Compose + send a brief WITHOUT deciding anything. For a standing daily-brief
    // cron: it reads the current pending queue, classifies each item to know what
    // WOULD clear vs surface, and sends the one-line summary. It posts nothing,
    // signs nothing, and writes no ledger row; --scan remains the only path that
    // acts. Cleared-dollar total here is the in-envelope sum currently pending.
    const pending = await listPending(env);
    const tally = { posted: 0, surfaced: 0, refused: 0, dry_run: 0 };
    const surfacedItems = [];
    let clearedCents = 0;
    for (const a of pending) {
      const cls = classify(a, env);
      if (cls.decision === "auto") {
        tally.posted += 1;
        clearedCents += Number(cls.amount_cents || 0);
      } else {
        tally.surfaced += 1;
        surfacedItems.push({ disposition: "surfaced", approval: a, reason: cls.reason, amount_cents: cls.amount_cents ?? null });
      }
    }
    surfacedItems.__clearedCents = clearedCents;
    const brief = composeBrief(tally, surfacedItems, env);
    messageOwner(brief);
    log(`\nbrief-only complete: nothing decided, brief sent.`);
    return;
  }

  console.error("decide: pass --scan, --approval <id>, --brief-only, or --selfcheck");
  process.exit(1);
}

main().catch((e) => {
  console.error(`decide: ${e.message}`);
  process.exit(1);
});

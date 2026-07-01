// Acceptance runner for spec step-up-approval — capabilities, value-constraints, step-up.
// Drives the real agent runtime + a real human session against the live AuthCo agent
// plane. Run with: node --env-file=.env scripts/accept-stepup.mjs
//
// The approval ladder under test (src/lib/auth.ts):
//   read_notes       approvalStrength "none"     -> auto-granted within host budget
//   share_note       approvalStrength "session"  -> human approves; value-constrained (recipientDomain); REUSABLE
//   delete_note      approvalStrength "session"  -> human approves; value-constrained (noteId); SINGLE-USE
//   delete_all_notes approvalStrength "webauthn" -> requires physical presence; a session alone cannot approve

import { neon } from "@neondatabase/serverless";
import { kp, signHostJwt, signAgentJwt, api } from "../agent-consumer/agent.mjs";

const BASE = process.env.AUTHCO_BASE_URL ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);
const results = [];
const record = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

// --- a real human session (the source of authority) ---
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const x = c.split(";")[0], i = x.indexOf("="); if (i > 0) jar.set(x.slice(0, i), x.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpj = async (p, b) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(b), redirect: "manual" }); absorb(r); let d = null; try { d = await r.json(); } catch {} return { status: r.status, body: d }; };

const email = `stepup-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jpj("/api/auth/sign-up/email", { name: "Owner", email, password: "owner strong password 123" });
await jpj("/api/auth/sign-in/email", { email, password: "owner strong password 123" });

// One host for the whole run (created active). Each test registers a fresh agent.
const host = await kp();
const hostId = (await jpj("/api/auth/host/create", { name: "stepup-runtime", public_key: host.pubJwk })).body.hostId;

// Register a delegated agent requesting `caps` (array of {name, constraints?}).
async function register(caps) {
  const agent = await kp();
  const hostJwt = await signHostJwt(host, { agent_public_key: agent.pubJwk }, { iss: hostId });
  const reg = await api("POST", "/agent/register", { name: "cap-agent", mode: "delegated", capabilities: caps }, { authorization: `Bearer ${hostJwt}` });
  return { agent, id: reg.body.agent_id, reg };
}
const approve = (id, user_code) => jpj("/api/auth/agent/approve-capability", { agent_id: id, user_code, action: "approve" });
// Execute with a FRESH self-signed agent JWT each call (jti replay protection forbids reuse).
// `claimCaps` lets a test forge a wider capabilities claim than it was granted (self-widen probe).
const exec = async (agent, id, capability, args, claimCaps) =>
  api("POST", "/capability/execute", { capability, arguments: args },
    { authorization: `Bearer ${await signAgentJwt(agent, id, claimCaps ?? [capability], {})}` });

const ACME = { noteId: "n1", recipient: "x@acme.com", recipientDomain: "acme.com" };
const EVIL = { noteId: "n2", recipient: "y@evil.com", recipientDomain: "evil.com" };

// ===== AC-1: least privilege — a granted cap works; an ungranted one is refused; no self-widen =====
{
  // read_notes is approvalStrength "none" and in the host budget -> auto-granted, no approval call.
  const { agent, id } = await register([{ name: "read_notes" }]);
  const granted = await exec(agent, id, "read_notes", { ownerId: "me" });
  const ungranted = await exec(agent, id, "share_note", ACME);                 // never granted
  // self-widen: stuff extra caps into the JWT claim. The server intersects the claim
  // with ACTIVE grants, so a forged claim cannot manufacture authority.
  const widen = await exec(agent, id, "share_note", ACME, ["read_notes", "share_note", "delete_all_notes"]);
  record("AC-1",
    granted.status === 200 && ungranted.status === 403 && widen.status === 403,
    `granted read_notes=${granted.status}; ungranted share_note=${ungranted.status} (${ungranted.body?.error}); self-widen share_note=${widen.status} (${widen.body?.error})`);
}

// ===== AC-2 / AC-3: value-constraint holds in-bounds, bites out-of-bounds, refusal doesn't consume =====
{
  const { agent, id, reg } = await register([{ name: "share_note", constraints: { recipientDomain: { in: ["acme.com"] } } }]);
  const appr = await approve(id, reg.body.approval?.user_code);
  const inBounds = await exec(agent, id, "share_note", ACME);                  // acme.com -> 200
  const outBounds = await exec(agent, id, "share_note", EVIL);                 // evil.com -> refused
  const stillWorks = await exec(agent, id, "share_note", ACME);               // grant survived the rejection
  record("AC-2", appr.status === 200 && inBounds.status === 200,
    `approve=${appr.status}; in-bounds (@acme.com)=${inBounds.status}`);
  record("AC-3",
    outBounds.status === 403 && outBounds.body?.error === "constraint_violated" && stillWorks.status === 200,
    `out-of-bounds (@evil.com)=${outBounds.status} (${outBounds.body?.error}); grant survived -> next in-bounds call=${stillWorks.status} (not consumed by the rejection)`);
}

// ===== AC-4: step-up — a session alone cannot approve the destructive (webauthn) capability =====
{
  const { agent, id, reg } = await register([{ name: "delete_all_notes" }]);
  const appr = await approve(id, reg.body.approval?.user_code);               // session-only approval attempt
  // A physical-presence refusal: webauthn_required (challenge issued, if a passkey is enrolled)
  // or webauthn_not_enrolled (no authenticator to challenge). Either way NOTHING is granted.
  // NOTE: completing the step-up needs a real/virtual authenticator; that is the ONLY missing
  //       piece here. With one registered, the same call returns webauthn_required + a challenge,
  //       and a valid assertion would activate the grant.
  const steppedUp = ["webauthn_required", "webauthn_not_enrolled"].includes(appr.body?.error);
  const grant = (await sql`SELECT status FROM "agentCapabilityGrant" WHERE "agentId"=${id} AND capability='delete_all_notes'`)[0];
  const notActive = grant?.status !== "active";                                // stays ungranted
  const cannotExec = await exec(agent, id, "delete_all_notes", {});           // agent still cannot execute
  record("AC-4",
    steppedUp && notActive && cannotExec.status === 403,
    `session approve refused with step-up=${appr.body?.error}; grant.status=${grant?.status ?? "none"} (not active=${notActive}); execute=${cannotExec.status} (${cannotExec.body?.error})`);
}

// ===== AC-5: single-use — a sensitive grant works exactly once (and its constraint holds) =====
{
  const { agent, id, reg } = await register([{ name: "delete_note", constraints: { noteId: { in: ["n1"] } } }]);
  const appr = await approve(id, reg.body.approval?.user_code);
  const outScope = await exec(agent, id, "delete_note", { noteId: "n2" });     // constraint bites, must NOT consume
  const first = await exec(agent, id, "delete_note", { noteId: "n1" });        // allowed -> 200, consumes the grant
  const second = await exec(agent, id, "delete_note", { noteId: "n1" });       // consumed -> not granted
  const grant = (await sql`SELECT status FROM "agentCapabilityGrant" WHERE "agentId"=${id} AND capability='delete_note'`)[0];
  record("AC-5",
    appr.status === 200 &&
      outScope.status === 403 && outScope.body?.error === "constraint_violated" &&
      first.status === 200 &&
      second.status === 403 && second.body?.error === "capability_not_granted" &&
      grant?.status === "consumed",
    `approve=${appr.status}; out-of-scope n2=${outScope.status} (${outScope.body?.error}, no consume); n1 #1=${first.status}; n1 #2=${second.status} (${second.body?.error}); grant.status=${grant?.status}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

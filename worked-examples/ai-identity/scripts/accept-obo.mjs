// Acceptance runner for the on-behalf-of (delegated authority) spec.
// Drives the real agent runtime + a real human session against the live AuthCo
// agent plane. Run with: node --env-file=.env scripts/accept-obo.mjs

import { neon } from "@neondatabase/serverless";
import { kp, signHostJwt, signAgentJwt, api } from "../agent-consumer/agent.mjs";

const BASE = process.env.AUTHCO_BASE_URL ?? "http://localhost:3000";
const ORIGIN = BASE;
const sql = neon(process.env.DATABASE_URL);

const results = [];
const record = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

// --- a real human session (the source of authority) ---
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const x = c.split(";")[0], i = x.indexOf("="); if (i > 0) jar.set(x.slice(0, i), x.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpj = async (p, b) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(b), redirect: "manual" }); absorb(r); let d = null; try { d = await r.json(); } catch {} return { status: r.status, body: d }; };

const email = `obo-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jpj("/api/auth/sign-up/email", { name: "Owner Person", email, password: "owner strong password 123" });
await jpj("/api/auth/sign-in/email", { email, password: "owner strong password 123" });
const session = await (await fetch(BASE + "/api/auth/get-session", { headers: { Cookie: ck() } })).json();
const HUMAN_ID = session?.user?.id;

// The agent runtime (separate keypairs; private keys never leave here).
const bHost = await kp();
const bAgent = await kp();
const hc = await jpj("/api/auth/host/create", { name: "obo-runtime", public_key: bHost.pubJwk });
const hostId = hc.body.hostId;

// Register a DELEGATED agent requesting share_note, scoped to recipientDomain acme.com.
const hostJwt = await signHostJwt(bHost, { agent_public_key: bAgent.pubJwk }, { iss: hostId });
const reg = await api("POST", "/agent/register",
  { name: "sharer", mode: "delegated", capabilities: [{ name: "share_note", constraints: { recipientDomain: { in: ["acme.com"] } } }] },
  { authorization: `Bearer ${hostJwt}` });
const aId = reg.body.agent_id;

async function exec(cap, args, jwtOpts = {}) {
  const jwt = await signAgentJwt(bAgent, aId, [cap], jwtOpts);
  return api("POST", "/capability/execute", { capability: cap, arguments: args }, { authorization: `Bearer ${jwt}` });
}
const ACME = { noteId: "n1", recipient: "x@acme.com", recipientDomain: "acme.com" };

// ===== AC-1: no approval, no grant =====
{
  const pending = reg.body.status === "pending";
  const before = await exec("share_note", ACME);
  const appr = await jpj("/api/auth/agent/approve-capability", { agent_id: aId, user_code: reg.body.approval.user_code, action: "approve" });
  const after = await exec("share_note", ACME);
  record("AC-1", pending && before.status !== 200 && appr.status === 200 && after.status === 200,
    `register=${reg.body.status}; before approval=${before.status} (${before.body?.error}); approve=${appr.status}; after approval=${after.status}`);
}

// ===== AC-2: bounded authority — only the approved capability, within its constraint =====
{
  const inScope = await exec("share_note", ACME);                                            // acme.com — within the approved scope
  const outScope = await exec("share_note", { noteId: "n2", recipient: "y@evil.com", recipientDomain: "evil.com" }); // outside it
  // "nothing wider": delete_all_notes was NEVER approved (and can't be auto-granted —
  // webauthn). Stuffing it into the agent JWT's capabilities claim doesn't help: the
  // server intersects the claim with the active grants.
  const wider = await exec("delete_all_notes", {});
  record("AC-2",
    inScope.status === 200 && outScope.status === 403 && outScope.body?.error === "constraint_violated" && wider.status !== 200,
    `in-constraint=${inScope.status}; out-of-constraint=${outScope.status} (${outScope.body?.error}); unapproved+self-widen delete_all_notes=${wider.status} (${wider.body?.error})`);
}

// ===== AC-3: time-boxed — past-exp token rejected; the delegation is not standing =====
{
  const pastExp = Math.floor(Date.now() / 1000) - 60;
  const expired = await exec("share_note", ACME, { exp: pastExp });
  const agentRow = (await sql`SELECT "expiresAt", "activatedAt" FROM "agent" WHERE id = ${aId}`)[0];
  const finite = agentRow?.expiresAt != null;
  record("AC-3", expired.status !== 200 && finite,
    `past-exp token=${expired.status} (${expired.body?.error}); agent expiresAt=${agentRow?.expiresAt} (finite=${finite}, not a standing delegation)`);
}

// ===== AC-5: not impersonation — attributable to the agent acting FOR the user =====
{
  const r = await exec("share_note", ACME);
  const d = r.body?.data ?? {};
  // both present, and the on-behalf-of user is the human, distinct from the agent
  record("AC-5",
    r.status === 200 && d.sharedByAgent === aId && d.onBehalfOf === HUMAN_ID && d.sharedByAgent !== d.onBehalfOf,
    `sharedByAgent=${String(d.sharedByAgent).slice(0, 8)}… (agent); onBehalfOf=${String(d.onBehalfOf).slice(0, 8)}… (== human ${d.onBehalfOf === HUMAN_ID}); agent != user=${d.sharedByAgent !== d.onBehalfOf}`);
}

// ===== AC-4b: granular (per-capability) revoke — one grant dies, the agent lives =====
// The human can pull back a SINGLE capability without killing the whole delegation.
// A fresh delegated agent gets share_note (approved) + read_notes (auto-granted). Revoking
// only share_note must stop share_note on the next call while read_notes keeps working —
// proof the revoke is grant-level, not agent-level (contrast AC-4, which revokes the agent).
{
  const b2 = await kp();
  const hj = await signHostJwt(bHost, { agent_public_key: b2.pubJwk }, { iss: hostId });
  const r2 = await api("POST", "/agent/register",
    { name: "sharer-granular", mode: "delegated",
      capabilities: [{ name: "share_note", constraints: { recipientDomain: { in: ["acme.com"] } } }, { name: "read_notes" }] },
    { authorization: `Bearer ${hj}` });
  const a2 = r2.body.agent_id;
  await jpj("/api/auth/agent/approve-capability", { agent_id: a2, user_code: r2.body.approval.user_code, action: "approve" });
  const exec2 = async (cap, args) => api("POST", "/capability/execute", { capability: cap, arguments: args },
    { authorization: `Bearer ${await signAgentJwt(b2, a2, [cap], {})}` });

  const shareBefore = await exec2("share_note", ACME);                             // granted -> 200
  const readBefore = await exec2("read_notes", { ownerId: HUMAN_ID });            // auto-granted -> 200
  const rc = await jpj("/api/auth/agent/revoke-capability", { agent_id: a2, capabilities: ["share_note"] }); // revoke ONE grant
  const shareAfter = await exec2("share_note", ACME);                             // the revoked capability must now fail
  const readAfter = await exec2("read_notes", { ownerId: HUMAN_ID });            // untouched authority still works -> agent NOT revoked
  record("AC-4b",
    shareBefore.status === 200 && readBefore.status === 200 && rc.status === 200 &&
      Array.isArray(rc.body?.revoked) && rc.body.revoked.includes("share_note") &&
      shareAfter.status !== 200 && readAfter.status === 200,
    `share before=${shareBefore.status}; revoke-capability=${rc.status} (revoked=${JSON.stringify(rc.body?.revoked)}); ` +
      `share after=${shareAfter.status} (${shareAfter.body?.error}); read still works=${readAfter.status} (agent alive, only the grant died)`);
}

// ===== AC-4: human revokes the whole delegation -> next on-behalf-of call fails =====
{
  const works = await exec("share_note", ACME);                                    // still 200
  const revoke = await jpj("/api/auth/agent/revoke", { agent_id: aId });           // HUMAN revokes (their session)
  const after = await exec("share_note", ACME);                                    // must fail
  record("AC-4", works.status === 200 && revoke.status === 200 && after.status !== 200,
    `before revoke=${works.status}; human revoke=${revoke.status} (${revoke.body?.status}); after revoke=${after.status} (${after.body?.error})`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

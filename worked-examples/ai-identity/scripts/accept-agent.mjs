// Acceptance runner for the frontier spec — an agent gets its own credential.
// Drives the real agent runtime (../agent-consumer/agent.mjs, jose-only) against
// the live AuthCo agent plane. Run with: node scripts/accept-agent.mjs

import { jwtVerify, createLocalJWKSet } from "jose";
import {
  kp, signAgentJwt, api, registerAutonomous, execute, revokeAgent, newJti,
} from "../agent-consumer/agent.mjs";

const AUTHCO = process.env.AUTHCO_BASE_URL ?? "http://localhost:3000";
const results = [];
const record = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

// --- a human credential, to prove the two planes never cross ---
async function humanToken() {
  const jar = new Map();
  const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
  const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const jp = (path, b) => fetch(AUTHCO + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: AUTHCO, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(b), redirect: "manual" }).then((r) => { absorb(r); return r; });
  const email = `agent-human-${Math.random().toString(16).slice(2, 8)}@example.com`;
  await jp("/api/auth/sign-up/email", { name: "Human", email, password: "human strong password 123" });
  await jp("/api/auth/sign-in/email", { email, password: "human strong password 123" });
  const tok = (await (await fetch(AUTHCO + "/api/auth/token", { headers: { Cookie: ck() } })).json()).token;
  const sub = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).sub;
  return { tok, sub };
}

// ===== AC-1: the agent obtains its OWN credential (subject = agent, not a human) =====
const { agent, reg } = await registerAutonomous({ name: "acc-reader", capabilities: ["read_notes"] });
const aId = reg.body.agent_id;
const ex = await execute(agent, aId, "read_notes", { ownerId: "u1" }, ["read_notes"]);
const readBy = ex.body?.data?.readBy;
{
  const human = await humanToken();
  // D1: a human RS256 token is refused at the agent execute endpoint
  const cross = await api("POST", "/capability/execute", { capability: "read_notes", arguments: {} }, { authorization: `Bearer ${human.tok}` });
  // D2: the agent's Ed25519 credential does NOT verify against the human RS256 JWKS
  const jwks = await (await fetch(AUTHCO + "/api/auth/jwks")).json();
  let agentRejectedByHumanJwks = false;
  try { await jwtVerify(await signAgentJwt(agent, aId, ["read_notes"]), createLocalJWKSet(jwks)); }
  catch { agentRejectedByHumanJwks = true; }
  const ownCred = ex.status === 200 && readBy === aId && aId !== human.sub;
  record("AC-1", ownCred && cross.status !== 200 && agentRejectedByHumanJwks,
    `subject=${String(aId).slice(0, 8)}… (==agent, != human ${String(human.sub).slice(0, 8)}…); human token at agent endpoint=${cross.status}; agent cred in human JWKS=${!agentRejectedByHumanJwks}`);
}

// ===== AC-2: least privilege — granted works, ungranted refused, no self-widening =====
{
  const granted = await execute(agent, aId, "read_notes", {}, ["read_notes"]);
  const ungranted = await execute(agent, aId, "delete_all_notes", {}, ["delete_all_notes"]);
  // widening: stuff the ungranted capability into the JWT's own capabilities claim
  const widen = await execute(agent, aId, "delete_all_notes", {}, ["read_notes", "delete_all_notes"]);
  record("AC-2", granted.status === 200 && ungranted.status !== 200 && widen.status !== 200,
    `granted read_notes=${granted.status}; ungranted delete_all_notes=${ungranted.status} (${ungranted.body?.error}); self-widen=${widen.status} (${widen.body?.error})`);
}

// ===== AC-3: tokens expire and resist replay (+ forgery) =====
{
  const pastExp = Math.floor(Date.now() / 1000) - 60; // already expired
  const expired = await execute(agent, aId, "read_notes", {}, ["read_notes"], { exp: pastExp });
  const jti = newJti();
  const r1 = await execute(agent, aId, "read_notes", {}, ["read_notes"], { jti });
  const r2 = await execute(agent, aId, "read_notes", {}, ["read_notes"], { jti }); // replay same jti
  const attacker = await kp();
  const forged = await execute(agent, aId, "read_notes", {}, ["read_notes"], { signKey: attacker.privateKey });
  record("AC-3", expired.status !== 200 && r1.status === 200 && r2.status !== 200 && forged.status !== 200,
    `expired=${expired.status} (${expired.body?.error}); replay first=${r1.status} second=${r2.status} (${r2.body?.error}); forged=${forged.status} (${forged.body?.error})`);
}

// ===== AC-4: revocation bites — revoke the agent, next call fails =====
{
  const { host: h2, agent: ag2, reg: reg2 } = await registerAutonomous({ name: "acc-revoke", capabilities: ["read_notes"] });
  const a2 = reg2.body.agent_id, host2 = reg2.body.host_id;
  const before = await execute(ag2, a2, "read_notes", {}, ["read_notes"]);
  const rev = await revokeAgent(h2, host2, a2);
  const after = await execute(ag2, a2, "read_notes", {}, ["read_notes"]);
  record("AC-4", before.status === 200 && rev.status === 200 && after.status !== 200,
    `before revoke=${before.status}; revoke=${rev.status} (${rev.body?.status}); after revoke=${after.status} (${after.body?.error})`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

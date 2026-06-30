/**
 * Independent AGENT consumer for AuthCo's agent-identity layer
 * (@better-auth/agent-auth). Talks to the running server over HTTP only and
 * signs its own Ed25519 JWTs with jose — no Better Auth import, the way a real
 * external agent runtime would. Proves the frontier end-to-end:
 *
 *   A. Autonomous   — an agent registers itself under a dynamically-created
 *                     host, gets its OWN short-lived credential, and executes an
 *                     auto-granted capability. Replay + forged-key are rejected.
 *   B. Delegated    — a human owns a host, an agent registers under it asking
 *                     for a value-CONSTRAINED capability; it stays pending until
 *                     the human approves via the device-code flow; then it works
 *                     within the constraint, is rejected outside it, and the
 *                     single-use grant is consumed.
 *   C. WebAuthn     — a destructive capability refuses session-only approval.
 *
 * Writes agent-consumer/result.json. Exits non-zero if any check fails.
 */
import { writeFileSync } from "node:fs";
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, createLocalJWKSet } from "jose";

const AUTHCO = process.env.BETTER_AUTH_URL || "http://localhost:3000";
const BASE = `${AUTHCO}/api/auth`;
const EXECUTE_AUD = `${BASE}/capability/execute`;
const PW = process.env.AGENT_HUMAN_PASSWORD || "Sup3rSecret-Passw0rd!";

let jc = 0;
const newJti = () => `jti-${Date.now()}-${jc++}`;
const result = { ok: false, checks: {}, evidence: {} };
const set = (k, cond, ev) => { result.checks[k] = !!cond; if (ev) result.evidence[k] = ev; };

async function call(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
function cookieFrom(res) {
  const sc = res.headers.get("set-cookie");
  if (!sc) return "";
  return sc.split(/,(?=[^;]+=[^;]+)/).map((c) => c.split(";")[0].trim()).join("; ");
}
async function kp() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  return { privateKey, pubJwk: await exportJWK(publicKey) };
}
const hostJwt = (hostKey, claims) =>
  new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", typ: "host+jwt" })
    .setAudience(BASE).setIssuedAt().setExpirationTime("50s").setJti(newJti()).sign(hostKey.privateKey);
const agentJwt = (agentKey, agentId, caps = []) =>
  new SignJWT({ capabilities: caps }).setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
    .setSubject(agentId).setAudience(EXECUTE_AUD).setIssuedAt().setExpirationTime("50s").setJti(newJti()).sign(agentKey.privateKey);

try {
  // === A. AUTONOMOUS: own credential, auto-grant, replay/forgery rejected ======
  const aHost = await kp();
  const aAgent = await kp();
  const aReg = await call("POST", "/agent/register",
    { name: "notes-reader", mode: "autonomous", capabilities: ["read_notes"] },
    { authorization: `Bearer ${await hostJwt(aHost, { host_public_key: aHost.pubJwk, agent_public_key: aAgent.pubJwk, host_name: "reader-runtime" })}` });
  const aId = aReg.body.agent_id;
  set("A1-register", aReg.status === 200 && !!aId, `status=${aReg.status} agent_id=${aId}`);
  set("A2-autograint", aReg.body.agent_capability_grants?.[0]?.status === "active", `read_notes grant=${aReg.body.agent_capability_grants?.[0]?.status}`);

  const aExec = await call("POST", "/capability/execute", { capability: "read_notes", arguments: { ownerId: "u1" } }, { authorization: `Bearer ${await agentJwt(aAgent, aId, ["read_notes"])}` });
  set("A3-execute", aExec.status === 200 && JSON.stringify(aExec.body).includes("buy milk"), `status=${aExec.status}`);

  const jti = newJti();
  const j1 = await new SignJWT({ capabilities: ["read_notes"] }).setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" }).setSubject(aId).setAudience(EXECUTE_AUD).setIssuedAt().setExpirationTime("50s").setJti(jti).sign(aAgent.privateKey);
  const j2 = await new SignJWT({ capabilities: ["read_notes"] }).setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" }).setSubject(aId).setAudience(EXECUTE_AUD).setIssuedAt().setExpirationTime("50s").setJti(jti).sign(aAgent.privateKey);
  const r1 = await call("POST", "/capability/execute", { capability: "read_notes", arguments: {} }, { authorization: `Bearer ${j1}` });
  const r2 = await call("POST", "/capability/execute", { capability: "read_notes", arguments: {} }, { authorization: `Bearer ${j2}` });
  set("A4-replay-rejected", r1.status === 200 && r2.status !== 200, `first=${r1.status} replay=${r2.status} ${r2.body?.error || ""}`);

  const attacker = await kp();
  const forged = await agentJwt(attacker, aId, ["read_notes"]);
  const rf = await call("POST", "/capability/execute", { capability: "read_notes", arguments: {} }, { authorization: `Bearer ${forged}` });
  set("A5-forgery-rejected", rf.status !== 200, `status=${rf.status} ${rf.body?.error || ""}`);

  // === B. DELEGATED + human device-code approval + value constraint ============
  const email = `agent-owner-${Date.now()}@example.com`;
  const su = await call("POST", "/sign-up/email", { email, password: PW, name: "Agent Owner" }, { origin: AUTHCO });
  const cookie = cookieFrom(su);
  set("B1-human", su.status === 200 && !!cookie, `signup=${su.status}`);

  const bHost = await kp();
  const hc = await call("POST", "/host/create", { name: "owner-laptop", public_key: bHost.pubJwk }, { cookie, origin: AUTHCO });
  const hostId = hc.body.hostId;
  set("B2-host", hc.status === 200 && !!hostId, `host=${hc.status} id=${hostId}`);

  const bAgent = await kp();
  const bReg = await call("POST", "/agent/register",
    { name: "sharer", mode: "delegated", capabilities: [{ name: "share_note", constraints: { recipientDomain: { in: ["acme.com"] } } }] },
    { authorization: `Bearer ${await new SignJWT({ agent_public_key: bAgent.pubJwk }).setProtectedHeader({ alg: "EdDSA", typ: "host+jwt" }).setIssuer(hostId).setAudience(BASE).setIssuedAt().setExpirationTime("50s").setJti(newJti()).sign(bHost.privateKey)}` });
  const bId = bReg.body.agent_id;
  const userCode = bReg.body.approval?.user_code;
  set("B3-pending", bReg.body.status === "pending" && !!userCode, `status=${bReg.body.status} user_code=${userCode}`);

  const pre = await call("POST", "/capability/execute", { capability: "share_note", arguments: { noteId: "n1", recipient: "x@acme.com", recipientDomain: "acme.com" } }, { authorization: `Bearer ${await agentJwt(bAgent, bId, ["share_note"])}` });
  set("B4-blocked-pre-approval", pre.status !== 200, `status=${pre.status} ${pre.body?.error || ""}`);

  const appr = await call("POST", "/agent/approve-capability", { agent_id: bId, user_code: userCode, action: "approve" }, { cookie, origin: AUTHCO });
  set("B5-approved", appr.status === 200, `status=${appr.status} ${JSON.stringify(appr.body).slice(0, 120)}`);

  const within = await call("POST", "/capability/execute", { capability: "share_note", arguments: { noteId: "n1", recipient: "ceo@acme.com", recipientDomain: "acme.com" } }, { authorization: `Bearer ${await agentJwt(bAgent, bId, ["share_note"])}` });
  set("B6-within-constraint", within.status === 200, `status=${within.status} ${JSON.stringify(within.body?.data || within.body).slice(0, 100)}`);

  const reuse = await call("POST", "/capability/execute", { capability: "share_note", arguments: { noteId: "n2", recipient: "ceo@acme.com", recipientDomain: "acme.com" } }, { authorization: `Bearer ${await agentJwt(bAgent, bId, ["share_note"])}` });
  set("B7-single-use", reuse.status !== 200, `status=${reuse.status} ${reuse.body?.error || ""}`);

  // Re-grant (owner direct) and prove the constraint REJECTS an out-of-scope domain.
  await call("POST", "/agent/grant-capability", { agent_id: bId, capabilities: [{ name: "share_note", constraints: { recipientDomain: { in: ["acme.com"] } } }] }, { cookie, origin: AUTHCO });
  const over = await call("POST", "/capability/execute", { capability: "share_note", arguments: { noteId: "n3", recipient: "spy@evil.com", recipientDomain: "evil.com" } }, { authorization: `Bearer ${await agentJwt(bAgent, bId, ["share_note"])}` });
  set("B8-constraint-violated", over.status === 403 && over.body?.error === "constraint_violated", `status=${over.status} ${over.body?.error || ""}`);

  // === C. WEBAUTHN guardrail: destructive capability refuses session-only approval
  const cHost = await kp();
  const chc = await call("POST", "/host/create", { name: "destroyer-host", public_key: cHost.pubJwk }, { cookie, origin: AUTHCO });
  const cAgent = await kp();
  const cReg = await call("POST", "/agent/register",
    { name: "destroyer", mode: "delegated", capabilities: ["delete_all_notes"] },
    { authorization: `Bearer ${await new SignJWT({ agent_public_key: cAgent.pubJwk }).setProtectedHeader({ alg: "EdDSA", typ: "host+jwt" }).setIssuer(chc.body.hostId).setAudience(BASE).setIssuedAt().setExpirationTime("50s").setJti(newJti()).sign(cHost.privateKey)}` });
  const cAppr = await call("POST", "/agent/approve-capability", { agent_id: cReg.body.agent_id, user_code: cReg.body.approval?.user_code, action: "approve" }, { cookie, origin: AUTHCO });
  set("C1-webauthn-refused", /webauthn/.test(JSON.stringify(cAppr.body)) && cAppr.body?.status !== "approved", `${cAppr.body?.error || JSON.stringify(cAppr.body).slice(0, 80)}`);
  const cExec = await call("POST", "/capability/execute", { capability: "delete_all_notes", arguments: {} }, { authorization: `Bearer ${await agentJwt(cAgent, cReg.body.agent_id, ["delete_all_notes"])}` });
  set("C2-destructive-blocked", cExec.status !== 200, `status=${cExec.status} ${cExec.body?.error || ""}`);

  // === D. SEPARATION: the human issuer and the agent plane don't cross over =====
  const tok = await call("GET", "/token", undefined, { cookie });
  const humanJwt = tok.body?.token;
  const jwks = await call("GET", "/jwks");
  const cross = await call("POST", "/capability/execute", { capability: "read_notes", arguments: {} }, { authorization: `Bearer ${humanJwt}` });
  set("D1-human-token-rejected-at-agent", !!humanJwt && cross.status !== 200, `status=${cross.status} ${cross.body?.error || ""}`);
  let agentRejectedByHumanJwks = false;
  try { await jwtVerify(await agentJwt(aAgent, aId, ["read_notes"]), createLocalJWKSet(jwks.body)); } catch { agentRejectedByHumanJwks = true; }
  set("D2-agent-cred-not-in-human-jwks", agentRejectedByHumanJwks, "agent Ed25519 cred does not verify against human RS256 JWKS");

  result.ok = Object.values(result.checks).every(Boolean);
} catch (e) {
  result.error = String(e?.stack || e);
}

writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

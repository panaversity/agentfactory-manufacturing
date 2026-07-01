// An autonomous AGENT runtime. It imports only `jose` — never Better Auth, never
// AuthCo's database. It generates its OWN Ed25519 keypair, registers its public
// key under a host, and SELF-SIGNS short-lived proof-of-possession JWTs for every
// call. AuthCo verifies the signature against the registered public key; it never
// hands the agent a bearer token to lose.
import { generateKeyPair, exportJWK, SignJWT } from "jose";

export const AUTH_BASE = (process.env.AUTHCO_BASE_URL ?? "http://localhost:3000") + "/api/auth";
export const EXECUTE_AUD = `${AUTH_BASE}/capability/execute`;

let _n = 0;
export function newJti() {
  // unique per process run (no Math.random needed): time + counter
  return `jti-${Date.now().toString(36)}-${_n++}-${process.pid}`;
}

// The agent's own keypair. The PRIVATE key never leaves this process.
export async function kp() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  return { privateKey, pubJwk: await exportJWK(publicKey) };
}

// host+jwt: proves the runtime that is registering an agent (carries the public
// keys inline for autonomous dynamic-host registration). aud = the auth base.
export async function signHostJwt(hostKey, claims, { jti = newJti(), exp = "50s", iss } = {}) {
  const s = new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", typ: "host+jwt" })
    .setAudience(AUTH_BASE).setIssuedAt().setExpirationTime(exp).setJti(jti);
  // Dynamic-host registration carries the public key inline; later host actions
  // (e.g. revoke) authenticate with iss = the registered host id.
  if (iss) s.setIssuer(iss);
  return s.sign(hostKey.privateKey);
}

// Operator revokes the whole agent (host action, authenticated by iss = host_id).
export async function revokeAgent(hostKey, hostId, agentId) {
  const jwt = await signHostJwt(hostKey, {}, { iss: hostId });
  return api("POST", "/agent/revoke", { agent_id: agentId }, { authorization: `Bearer ${jwt}` });
}

// agent+jwt: the agent's OWN short-lived credential. sub = the agent id (not a
// human), aud = the execute endpoint, capabilities claim, jti for replay defense.
// opts let the test forge (signKey), replay (fixed jti), or expire (past exp).
export async function signAgentJwt(agentKey, agentId, caps = [], opts = {}) {
  const { jti = newJti(), exp = "50s", signKey = agentKey.privateKey } = opts;
  const s = new SignJWT({ capabilities: caps })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
    .setSubject(agentId).setAudience(EXECUTE_AUD).setIssuedAt().setJti(jti);
  // exp may be a duration string ("50s") or an absolute unix seconds (for past-exp)
  s.setExpirationTime(exp);
  return s.sign(signKey);
}

export async function api(method, path, body, headers = {}) {
  const res = await fetch(AUTH_BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data = null; const text = await res.text();
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, body: data, text };
}

// Register an autonomous agent via dynamic host registration (one call).
export async function registerAutonomous({ name = "notes-reader", capabilities = ["read_notes"] } = {}) {
  const host = await kp();
  const agent = await kp();
  const hostJwt = await signHostJwt(host, {
    host_public_key: host.pubJwk,
    agent_public_key: agent.pubJwk,
    host_name: "reader-runtime",
  });
  const reg = await api("POST", "/agent/register",
    { name, mode: "autonomous", capabilities },
    { authorization: `Bearer ${hostJwt}` });
  return { host, agent, reg };
}

// Execute a capability with a freshly self-signed agent JWT.
export async function execute(agentKey, agentId, capability, args = {}, caps = [capability], jwtOpts = {}) {
  const jwt = await signAgentJwt(agentKey, agentId, caps, jwtOpts);
  return api("POST", "/capability/execute", { capability, arguments: args }, { authorization: `Bearer ${jwt}` });
}

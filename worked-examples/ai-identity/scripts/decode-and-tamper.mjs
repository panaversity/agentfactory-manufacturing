// Issue a fresh ID token, decode every claim, then tamper the `aud` by one
// character and show the independent verifier rejecting it.
import { runOAuthFlow } from "./run-oauth-flow.mjs";
import { verifyToken } from "./verify-token.mjs";

const dec = (seg) => JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

const flow = await runOAuthFlow();
const token = flow.idToken;
const [h, p, s] = token.split(".");
const header = dec(h);
const payload = dec(p);

console.log("\n================ RAW TOKEN (three dot-separated parts) ================");
console.log(token);
console.log(`\nheader  = ${h.slice(0, 24)}…  (${h.length} chars)`);
console.log(`payload = ${p.slice(0, 24)}…  (${p.length} chars)`);
console.log(`sig     = ${s.slice(0, 24)}…  (${s.length} chars)`);

console.log("\n================ HEADER ================");
console.log(JSON.stringify(header, null, 2));

console.log("\n================ PAYLOAD (claims) ================");
console.log(JSON.stringify(payload, null, 2));

console.log("\n================ CLAIMS IN PLAIN ENGLISH ================");
const now = Math.floor(Date.now() / 1000);
const human = (t) => new Date(t * 1000).toISOString();
const fmtDur = (secs) => {
  const a = Math.abs(secs);
  if (a < 60) return `${a}s`;
  if (a < 3600) return `${Math.round(a / 60)}m`;
  return `${(a / 3600).toFixed(1)}h`;
};
const lines = {
  iss: `WHO ISSUED IT  -> "${payload.iss}". The verifier rejects anything not from this exact string.`,
  aud: `WHO IT'S FOR   -> "${payload.aud}". The client this token was minted for; a different app must refuse it.`,
  sub: `WHO IT'S ABOUT -> "${payload.sub}". The stable user id (the subject); this is *the person*.`,
  exp: `EXPIRES        -> ${payload.exp} = ${human(payload.exp)} (in ${fmtDur(payload.exp - now)}). After this instant a compliant verifier rejects it.`,
  iat: payload.iat != null ? `ISSUED AT      -> ${payload.iat} = ${human(payload.iat)} (${fmtDur(now - payload.iat)} ago).` : null,
  nbf: payload.nbf != null ? `NOT BEFORE     -> ${payload.nbf} = ${human(payload.nbf)}. Not valid before this.` : null,
  auth_time: payload.auth_time != null ? `AUTH TIME      -> ${human(payload.auth_time)}. When the user actually authenticated.` : null,
  nonce: payload.nonce != null ? `NONCE          -> "${payload.nonce}". Binds the token to one login request (replay defense).` : null,
  azp: payload.azp != null ? `AUTHORIZED PARTY -> "${payload.azp}". The party the token was released to.` : null,
  sid: payload.sid != null ? `SESSION ID     -> "${payload.sid}". Ties the token to a session (enables logout).` : null,
  at_hash: payload.at_hash != null ? `AT_HASH        -> "${payload.at_hash}". A fingerprint binding this ID token to its access token.` : null,
  jti: payload.jti != null ? `TOKEN ID       -> "${payload.jti}". Unique id for this token.` : null,
  name: payload.name != null ? `NAME           -> "${payload.name}". Profile claim (from the 'profile' scope).` : null,
  email: payload.email != null ? `EMAIL          -> "${payload.email}". Profile claim (from the 'email' scope).` : null,
  email_verified: payload.email_verified != null ? `EMAIL VERIFIED -> ${payload.email_verified}.` : null,
};
for (const k of Object.keys(payload)) {
  if (lines[k]) console.log(`• ${k.padEnd(14)} ${lines[k]}`);
  else console.log(`• ${k.padEnd(14)} (claim present: ${JSON.stringify(payload[k])})`);
}
console.log("\nHeader fields:");
console.log(`• alg            Signature algorithm: ${header.alg} (EdDSA / Ed25519).`);
if (header.kid) console.log(`• kid            Key id: ${header.kid} — tells the verifier which JWKS key to use.`);
if (header.typ) console.log(`• typ            Type: ${header.typ}.`);

// ---- Step 1: verify the genuine token ----
console.log("\n================ VERIFY THE GENUINE TOKEN ================");
const good = await verifyToken(token, { jwksUrl: flow.jwksUrl, issuer: flow.issuer, audience: flow.audience });
console.log(good.ok ? `ACCEPTED ✓  aud="${good.payload.aud}"` : `REJECTED ✗ ${good.code}`);

// ---- Step 2: tamper aud by ONE character, reassemble, verify ----
const tamperedAud = payload.aud.slice(0, -1) + (payload.aud.slice(-1) === "x" ? "y" : "x");
const tamperedPayload = { ...payload, aud: tamperedAud };
const tamperedToken = `${h}.${enc(tamperedPayload)}.${s}`; // original header + sig, new payload

console.log("\n================ TAMPER: change aud by one character ================");
console.log(`original aud : "${payload.aud}"`);
console.log(`tampered aud : "${tamperedAud}"   <-- one character changed`);
console.log("(header and signature left untouched; only the payload's aud differs)");

// Verify the tampered token while TELLING the verifier to expect the tampered
// aud — so the rejection cannot be a mere audience-mismatch; it is cryptographic.
console.log("\n================ VERIFIER ON THE TAMPERED TOKEN ================");
console.log(`(verifier configured to EXPECT the tampered aud "${tamperedAud}", to rule out a trivial aud-mismatch)`);
const bad = await verifyToken(tamperedToken, {
  jwksUrl: flow.jwksUrl,
  issuer: flow.issuer,
  audience: tamperedAud,
});
console.log(bad.ok ? `ACCEPTED (!!) — this would be a forgery hole` : `REJECTED ✗  ${bad.code} — ${bad.message}`);

process.exit(bad.ok ? 1 : 0);

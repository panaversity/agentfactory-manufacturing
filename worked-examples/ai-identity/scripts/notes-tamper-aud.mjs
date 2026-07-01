// Take a token Notes just verified, change its `aud` by ONE character, and run
// it back through Notes's OWN verifier (notes/lib/oauth.mjs). No new code path —
// the exact same verifyIdToken() Notes uses on every sign-in.
import { randomBytes, createHash } from "node:crypto";
import * as notes from "../notes/lib/oauth.mjs";

const AUTHCO = process.env.AUTHCO_BASE_URL ?? "http://localhost:3000";
const ORIGIN = AUTHCO;
const dec = (seg) => JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

// --- get a real token the way Notes does (AuthCo session + Notes's own flow) ---
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpost = (path, body) => fetch(AUTHCO + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(body), redirect: "manual" }).then((r) => { absorb(r); return r; });

const email = `tamper-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jpost("/api/auth/sign-up/email", { name: "Tamper Tester", email, password: "tamper strong password 12" });
await jpost("/api/auth/sign-in/email", { email, password: "tamper strong password 12" });

const { verifier, challenge, state } = notes.newPkce();
const authorizeUrl = await notes.buildAuthorizeUrl({ challenge, state, scope: "openid profile email" });
const ar = await fetch(authorizeUrl, { headers: { Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, redirect: "manual" });
let next = new URL((await ar.json()).url, AUTHCO);
if (!next.searchParams.get("code")) {
  const cons = await jpost("/api/auth/oauth2/consent", { accept: true, oauth_query: next.search.replace(/^\?/, "") });
  next = new URL((await cons.json()).url, AUTHCO);
}
const tok = await notes.exchangeCode({ code: next.searchParams.get("code"), verifier });
const idToken = tok.data.id_token;

// --- Step 1: Notes verifies the genuine token (its real code path) ---
console.log("================ GENUINE TOKEN — Notes verifies it ================");
const good = await notes.verifyIdToken(idToken);
console.log(`aud  = ${JSON.stringify(good.payload.aud)}`);
console.log(`sub  = ${good.payload.sub}`);
console.log(`Notes verifier: ACCEPTED ✓  (aud == Notes's own client_id "${notes.config.CLIENT_ID}")`);

// --- Step 2: change aud by ONE character, keep header + signature ---
const [h, p, s] = idToken.split(".");
const payload = dec(p);
const origAud = payload.aud;
const tamperedAud = origAud.slice(0, -1) + (origAud.slice(-1) === "p" ? "q" : "p"); // notes-app -> notes-apq
const tamperedToken = `${h}.${enc({ ...payload, aud: tamperedAud })}.${s}`;

console.log("\n================ TAMPER: aud changed by one character ================");
console.log(`original aud : "${origAud}"`);
console.log(`tampered aud : "${tamperedAud}"   <-- one character`);
console.log("(header + signature untouched; only the payload's aud differs)");

// --- Step 3: run the tampered token through Notes's SAME verifier ---
console.log("\n================ Notes's verifier on the tampered token ================");
try {
  await notes.verifyIdToken(tamperedToken);
  console.log("ACCEPTED (!!) — this would be a forgery hole");
  process.exit(1);
} catch (e) {
  console.log(`REJECTED ✗  ${e.code} — ${e.message}`);
  process.exit(0);
}

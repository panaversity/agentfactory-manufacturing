// Two demonstrations for spec 03:
//  (1) a notes.read-only token is refused at the write action — exact response;
//  (2) the /consent request for notes.read+notes.write, and proof the displayed
//      scopes are bound to the signed query.
import { randomBytes, createHash } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { runOAuthFlow } from "./run-oauth-flow.mjs";

const BASE = "http://localhost:3000";
const ORIGIN = BASE;
const RESOURCE = "http://localhost:3000/api/notes";
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString());

// ===================== DEMO 1: read-only token at the write action =====================
console.log("############ DEMO 1: notes.read-only token -> write action ############\n");
const read = await runOAuthFlow({
  clientId: process.env.READ_CLIENT_ID, clientSecret: process.env.READ_CLIENT_SECRET,
  scope: "openid notes.read", resource: RESOURCE,
});
const at = read.accessToken;
console.log("granted scope on the token :", read.grantedScope);
console.log("access token (decoded scope claim):", dec(at.split(".")[1]).scope);

// It signs fine — prove the signature/issuer/audience/exp all verify:
const JWKS = createRemoteJWKSet(new URL("http://localhost:3000/api/auth/jwks"));
const v = await jwtVerify(at, JWKS, { issuer: "http://localhost:3000/api/auth", audience: RESOURCE });
console.log("jose verify of the token   : VALID (sig ok, iss ok, aud ok, not expired) sub=" + v.payload.sub.slice(0, 8) + "…\n");

// Now use it on the write action:
const res = await fetch(BASE + "/api/notes", { method: "POST", headers: { Authorization: `Bearer ${at}` } });
console.log("POST /api/notes (write) with the read-only token:");
console.log("  HTTP status        :", res.status);
console.log("  WWW-Authenticate   :", res.headers.get("www-authenticate"));
console.log("  body               :", await res.text());
console.log("  (read action for comparison) GET /api/notes:",
  (await fetch(BASE + "/api/notes", { headers: { Authorization: `Bearer ${at}` } })).status);

// ===================== DEMO 2: the consent request and its binding =====================
console.log("\n\n############ DEMO 2: /consent for notes.read + notes.write ############\n");
// sign in to get a session, then drive authorize to obtain the signed consent query
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jpost = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(body), redirect: "manual" }).then((r) => { absorb(r); return r; });
const email = `consent-demo-${b64url(randomBytes(5))}@authco.test`;
await jpost("/api/auth/sign-up/email", { name: "Consent Demo", email, password: "consent demo strong pw 1" });
await jpost("/api/auth/sign-in/email", { email, password: "consent demo strong pw 1" });

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const au = new URL(BASE + "/api/auth/oauth2/authorize");
au.search = new URLSearchParams({
  response_type: "code", client_id: process.env.WRITE_CLIENT_ID, redirect_uri: "http://localhost:3000/callback",
  scope: "openid notes.read notes.write", state: "s", nonce: "n",
  code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE,
}).toString();
const ar = await fetch(au, { headers: { Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: ck() }, redirect: "manual" });
const consentUrl = new URL((await ar.json()).url, BASE);
const sq = consentUrl.searchParams;

console.log("authorize redirected the browser to:");
console.log("  " + consentUrl.pathname + "?…(signed)\n");
console.log("the consent page reads these from the query string it was given:");
console.log("  scope =", JSON.stringify(sq.get("scope")));
console.log("  client_id =", JSON.stringify(sq.get("client_id")));
console.log("  sig   =", (sq.get("sig") ?? "").slice(0, 24) + "…  (HMAC over the listed ba_param fields)");
console.log("\n=> the two lines on screen come straight from scope:",
  sq.get("scope").split(/\s+/).filter(Boolean).join(", "));

// Binding proof: tamper the displayed scope, post it back -> signature fails.
const tampered = consentUrl.search.replace(/^\?/, "").replace(/scope=[^&]*/, "scope=" + encodeURIComponent("openid notes.read notes.write notes.delete"));
const tamperRes = await jpost("/api/auth/oauth2/consent", { accept: true, oauth_query: tampered });
console.log("\nBinding proof — approve a query whose scope was inflated to add 'notes.delete':");
console.log("  consent POST ->", tamperRes.status, await tamperRes.text());

// And the honest query approves cleanly, granting exactly what was shown:
const honest = await jpost("/api/auth/oauth2/consent", { accept: true, oauth_query: consentUrl.search.replace(/^\?/, "") });
const honestData = await honest.json().catch(() => ({}));
const code = honestData.url ? new URL(honestData.url, BASE).searchParams.get("code") : null;
console.log("  honest consent POST ->", honest.status, "code issued:", !!code);

// Print the consent URL so it can be opened in a browser for a screenshot.
console.log("\nCONSENT_URL=" + consentUrl.toString());

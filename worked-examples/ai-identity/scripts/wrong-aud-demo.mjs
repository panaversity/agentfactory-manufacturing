// A token AuthCo genuinely signed for API-A (aud=http://localhost:8000),
// presented to API-B (http://localhost:9100). Same code, different identity.
// Shows API-B refusing it on AUDIENCE while the signature stays genuine —
// then shows that "just editing the aud to B's URL" breaks the seal instead.
const AUTHCO = "http://localhost:3000";
const API_A = "http://localhost:8000/api/resource";
const API_B = "http://localhost:9100/api/resource";
const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// --- mint a genuine token (aud = http://localhost:8000) ---
const jar = new Map();
const absorb = (r) => (r.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1)); });
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const jp = (path, b) => fetch(AUTHCO + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: AUTHCO, "sec-fetch-mode": "cors", Cookie: ck() }, body: JSON.stringify(b), redirect: "manual" }).then((r) => { absorb(r); return r; });
const email = `wrongaud-${Math.random().toString(16).slice(2, 8)}@example.com`;
await jp("/api/auth/sign-up/email", { name: "Aud Demo", email, password: "aud demo strong password 1" });
await jp("/api/auth/sign-in/email", { email, password: "aud demo strong password 1" });
const token = (await (await fetch(AUTHCO + "/api/auth/token", { headers: { Cookie: ck() } })).json()).token;
const claims = dec(token.split(".")[1]);

const call = async (api, tok) => {
  const r = await fetch(api, { headers: { Authorization: `Bearer ${tok}` } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

console.log("================ THE GENUINE TOKEN ================");
console.log(`AuthCo signed it: alg=RS256, iss=${claims.iss}, aud=${claims.aud}, sub=${claims.sub.slice(0, 8)}…\n`);

console.log("================ API-A (its own URL == the token's aud) ================");
const a = await call(API_A, token);
console.log(`POST to ${API_A} -> ${a.status}  ${JSON.stringify(a.body).slice(0, 90)}`);

console.log("\n================ API-B (a DIFFERENT API; same genuine token) ================");
const b = await call(API_B, token);
console.log(`POST to ${API_B} -> ${b.status}  ${JSON.stringify(b.body)}`);
console.log(`  ^ signature is genuine (API-A just accepted it); API-B refuses purely on aud.`);

console.log("\n================ 'Just change the aud to B's URL' ================");
const [h, p, s] = token.split(".");
const readdressed = `${h}.${enc({ ...claims, aud: "http://localhost:9100" })}.${s}`;
const t = await call(API_B, readdressed);
console.log(`edited aud -> "http://localhost:9100", same signature; POST to API-B -> ${t.status}  ${JSON.stringify(t.body)}`);
console.log(`  ^ now the aud matches B, but editing it broke AuthCo's seal -> rejected as tampered, not accepted.`);

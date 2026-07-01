// Issue a token, then verify it (a) as of now and (b) with the clock advanced
// one second past its exp. Shows the exact rejection from a compliant verifier.
import { runOAuthFlow } from "./run-oauth-flow.mjs";
import { verifyToken } from "./verify-token.mjs";

const flow = await runOAuthFlow();
const payload = JSON.parse(Buffer.from(flow.idToken.split(".")[1], "base64url").toString());
const exp = payload.exp;
const human = (t) => new Date(t * 1000).toISOString();

console.log("\n================ THE TOKEN ================");
console.log(`sub : ${payload.sub}`);
console.log(`aud : ${payload.aud}`);
console.log(`iat : ${payload.iat}  (${human(payload.iat)})`);
console.log(`exp : ${exp}  (${human(exp)})`);

const opts = { jwksUrl: flow.jwksUrl, issuer: flow.issuer, audience: flow.audience };

// (a) as of issuance — still valid
const before = new Date((payload.iat + 5) * 1000);
console.log("\n================ USE IT AT ISSUANCE TIME ================");
console.log(`clock = ${before.toISOString()}  (before exp)`);
const r1 = await verifyToken(flow.idToken, { ...opts, currentDate: before });
console.log(r1.ok ? `ACCEPTED ✓  exp is ${human(r1.payload.exp)}` : `REJECTED ✗ ${r1.code}`);

// (b) one second past exp — must be rejected
const after = new Date((exp + 1) * 1000);
console.log("\n================ MOVE THE CLOCK PAST EXPIRY ================");
console.log(`clock = ${after.toISOString()}  (1s after exp ${human(exp)})`);
const r2 = await verifyToken(flow.idToken, { ...opts, currentDate: after });
if (r2.ok) {
  console.log("ACCEPTED (!!) — an expired token was honored. This is a failure.");
  process.exit(1);
} else {
  console.log("REJECTED ✗");
  console.log(`  error code    : ${r2.code}`);
  console.log(`  error message : ${r2.message}`);
  process.exit(0);
}

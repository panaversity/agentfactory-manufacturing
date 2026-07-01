// Sign a token with EdDSA and present it to the RS256-only resource server.
// The token is otherwise PERFECT — correct iss, aud, sub, future exp — so the
// only thing wrong is the signing algorithm. That isolates the alg check.
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import { verifyAccessToken } from "../resource-server/lib/verify.mjs";

const AUTH_ISSUER = process.env.AUTH_ISSUER ?? "http://localhost:3000";
const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://localhost:8000";
const API = "http://localhost:8000/api/resource";

// 1) Mint an EdDSA-signed token with all the RIGHT claims.
const { privateKey } = await generateKeyPair("EdDSA");
const eddsaToken = await new SignJWT({})
  .setProtectedHeader({ alg: "EdDSA", kid: "attacker-eddsa-key" })
  .setIssuer(AUTH_ISSUER)        // correct issuer
  .setAudience(RESOURCE_URL)     // correct audience
  .setSubject("evil-user")       // a subject
  .setIssuedAt()
  .setExpirationTime("1h")       // not expired
  .sign(privateKey);

const hdr = JSON.parse(Buffer.from(eddsaToken.split(".")[0], "base64url").toString());
const pl = JSON.parse(Buffer.from(eddsaToken.split(".")[1], "base64url").toString());
console.log("================ THE EdDSA TOKEN (claims all correct) ================");
console.log(`header : ${JSON.stringify(hdr)}`);
console.log(`claims : iss=${pl.iss}  aud=${pl.aud}  sub=${pl.sub}  exp in the future`);
console.log("Only the algorithm is wrong: EdDSA, not the RS256 this verifier accepts.\n");

// 2) Present it to the LIVE resource server (HTTP).
console.log("================ Live resource server (RS256-only) ================");
const res = await fetch(API, { headers: { Authorization: `Bearer ${eddsaToken}` } });
const body = await res.json().catch(() => ({}));
console.log(`GET /api/resource  ->  HTTP ${res.status}`);
console.log(`WWW-Authenticate: ${res.headers.get("www-authenticate")}`);
console.log(`body: ${JSON.stringify(body)}`);

// 3) Call the verifier directly for the exact jose error.
console.log("\n================ The verifier's exact error ================");
try {
  await verifyAccessToken(eddsaToken);
  console.log("ACCEPTED (!!) — this would be a break");
  process.exit(1);
} catch (e) {
  console.log(`code    : ${e.code}`);
  console.log(`message : ${e.message}`);
  process.exit(0);
}

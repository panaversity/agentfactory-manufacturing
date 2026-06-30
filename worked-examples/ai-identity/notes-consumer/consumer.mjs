/**
 * Notes — an INDEPENDENT OAuth/OIDC consumer of AuthCo.
 *
 * This process is deliberately separate from AuthCo: it has NO access to
 * AuthCo's database, NO copy of BETTER_AUTH_SECRET, and never sees a user's
 * AuthCo password. It owns only its own OAuth client credentials
 * (client_id + client_secret) and verifies AuthCo-issued ID tokens using
 * ONLY the public JWKS endpoint via `jose` — exactly what a third-party app
 * would do.
 *
 * It plays two roles, kept visually separate below:
 *   [USER-BROWSER]  carries the AuthCo session cookie, drives authorize+consent.
 *   [NOTES-SERVER]  holds the client secret, exchanges the code, and verifies
 *                   the ID token offline against JWKS.
 *
 * It runs the happy path (AC-3/AC-4) and the adversarial checks it owns
 * (AC-6 expiry, AC-8 audience/issuer, AC-9 single-use code, plus userinfo as a
 * protected resource), then writes a machine-readable result.json that
 * verify.sh turns into PASS/FAIL lines.
 */
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync, appendFileSync } from "node:fs";

const AUTHCO = process.env.AUTHCO_URL || "http://localhost:3000";
const CLIENT_ID = process.env.NOTES_CLIENT_ID || "notes-app";
const CLIENT_SECRET = process.env.NOTES_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.NOTES_REDIRECT_URI || "http://localhost:4567/callback";
const USER_EMAIL = process.env.NOTES_USER_EMAIL || "notes-user@example.com";
const USER_PASSWORD = process.env.NOTES_USER_PASSWORD || "Sup3rSecret-Passw0rd!";
const BODIES_LOG = process.env.BODIES_LOG || "./bodies.log";
const RESULT_FILE = process.env.RESULT_FILE || "./notes-consumer/result.json";

const result = {
  ok: false,
  steps: {},
  evidence: {},
  checks: {}, // ac3..ac10 booleans the consumer is responsible for
  error: null,
};

// ---- tiny helpers ---------------------------------------------------------
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}
function logBody(tag, text) {
  // Capture every response body Notes sees, for the secret/password leak scans.
  try { appendFileSync(BODIES_LOG, `\n===== ${tag} =====\n${text}\n`); } catch {}
}
async function readBody(res) {
  const t = await res.text();
  return t;
}

let cookie = ""; // AuthCo session cookie held by the [USER-BROWSER] half only.
function captureCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(";")[0];
    if (pair && pair.includes("=")) cookie = cookie ? cookie + "; " + pair : pair;
  }
}

async function main() {
  // ---------------------------------------------------------------------
  // [USER-BROWSER] Establish an AuthCo login session (sign-up then sign-in).
  // In a real deployment the user already has this cookie; Notes never sees
  // the password. We do it here only to obtain the browser session for the
  // redirect dance.
  // ---------------------------------------------------------------------
  let r = await fetch(`${AUTHCO}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: AUTHCO },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, name: "Notes User" }),
  });
  logBody("sign-up", await readBody(r));
  // sign-in (works whether or not the user already existed)
  r = await fetch(`${AUTHCO}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: AUTHCO },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });
  captureCookies(r);
  logBody("sign-in", await readBody(r));
  if (!cookie) throw new Error("could not obtain AuthCo session cookie");
  result.steps.session = true;

  // ---------------------------------------------------------------------
  // [USER-BROWSER] Authorization request (authorization-code flow + PKCE).
  // sec-fetch-mode:cors makes AuthCo answer with JSON {redirect,url} instead
  // of a raw 302, which is simpler to follow headlessly.
  // ---------------------------------------------------------------------
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authQ = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  r = await fetch(`${AUTHCO}/api/auth/oauth2/authorize?${authQ}`, {
    headers: { cookie, origin: AUTHCO, "sec-fetch-mode": "cors" },
  });
  const authText = await readBody(r);
  logBody("authorize", authText);
  let consentUrl;
  try { consentUrl = JSON.parse(authText).url; } catch {}
  if (!consentUrl) throw new Error("authorize did not return a redirect url: " + authText.slice(0, 200));
  // The provider redirected the browser to the consent page. In this version of
  // the plugin the consent state is carried as a SIGNED oauth query string in
  // the consent page URL (client_id, scope, redirect_uri, ... plus exp + sig),
  // NOT a consent_code. The consent page reads it and hands it straight back.
  const consentQuery = consentUrl.split("?")[1];
  if (!consentQuery) throw new Error("no signed oauth query in authorize redirect: " + consentUrl);
  result.steps.authorize = true;
  result.evidence.consent_redirect = consentUrl;

  // ---------------------------------------------------------------------
  // [USER-BROWSER] Consent: the user explicitly approves (accept: true).
  // We pass the signed oauth_query back; the endpoint verifies the signature,
  // records consent, mints the real authorization code, and returns the
  // client's redirect URL with ?code=...  (JSON form for headless callers).
  // ---------------------------------------------------------------------
  r = await fetch(`${AUTHCO}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", cookie, origin: AUTHCO },
    body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
  });
  const consentText = await readBody(r);
  logBody("consent", consentText);
  const redirectURI = (() => { try { return JSON.parse(consentText).url; } catch { return null; } })();
  if (!redirectURI) throw new Error("consent did not return a redirect url: " + consentText.slice(0, 200));
  const cbUrl = new URL(redirectURI);
  const code = cbUrl.searchParams.get("code");
  const returnedState = cbUrl.searchParams.get("state");
  if (!code) throw new Error("no authorization code in consent redirect: " + redirectURI);
  if (returnedState !== state) throw new Error("state mismatch (CSRF guard): " + returnedState);
  result.steps.consent = true;

  // ---------------------------------------------------------------------
  // [NOTES-SERVER] Token exchange with the client's own credentials + PKCE
  // verifier. The user password is NOT involved here.
  // ---------------------------------------------------------------------
  async function exchange(theCode) {
    // Registered token_endpoint_auth_method is client_secret_basic: send the
    // client credentials in an HTTP Basic header, not the body.
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: theCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const tr = await fetch(`${AUTHCO}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
        origin: AUTHCO,
      },
      body,
    });
    const tt = await readBody(tr);
    return { status: tr.status, text: tt };
  }

  const tok1 = await exchange(code);
  logBody("token-exchange-1", tok1.text);
  const tokens = (() => { try { return JSON.parse(tok1.text); } catch { return {}; } })();
  if (tok1.status !== 200 || !tokens.id_token) {
    throw new Error(`token exchange failed (${tok1.status}): ${tok1.text.slice(0, 300)}`);
  }
  const idToken = tokens.id_token;
  const accessToken = tokens.access_token;
  result.steps.token = true;
  // AC-3: received a signed ID token (JWT, 3 dot-separated parts).
  result.checks.ac3 = typeof idToken === "string" && idToken.split(".").length === 3;
  result.evidence.ac3 = `id_token header.alg=${JSON.parse(Buffer.from(idToken.split(".")[0], "base64url").toString()).alg}, parts=${idToken.split(".").length}`;

  // ---------------------------------------------------------------------
  // [NOTES-SERVER] Discover issuer + jwks_uri, then verify the ID token using
  // ONLY the public JWKS. No shared secret, no DB call.
  // ---------------------------------------------------------------------
  const disc = await (await fetch(`${AUTHCO}/api/auth/.well-known/openid-configuration`)).json();
  const ISSUER = disc.issuer;
  const JWKS = createRemoteJWKSet(new URL(disc.jwks_uri));

  // AC-4: verify offline against JWKS and read the subject.
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUER, audience: CLIENT_ID });
  result.checks.ac4 = !!payload.sub && payload.aud === CLIENT_ID && payload.iss === ISSUER && !!payload.exp;
  result.evidence.ac4 = `verified via JWKS only; sub=${payload.sub}, aud=${payload.aud}, iss=${payload.iss}, exp=${payload.exp}, nonce_match=${payload.nonce === nonce}`;

  // AC-6: a token past its exp is rejected. We advance the verifier's clock
  // past `exp` (cannot wait an hour live); a compliant resource MUST reject.
  try {
    await jwtVerify(idToken, JWKS, {
      issuer: ISSUER,
      audience: CLIENT_ID,
      currentDate: new Date((payload.exp + 60) * 1000),
    });
    result.checks.ac6 = false;
    result.evidence.ac6 = "FAIL: expired token was accepted";
  } catch (e) {
    result.checks.ac6 = e.code === "ERR_JWT_EXPIRED" || /exp/i.test(String(e.message));
    result.evidence.ac6 = `rejected post-exp: ${e.code || e.message}`;
  }

  // AC-8: audience and issuer are enforced by the verifier.
  let wrongAud = false, wrongIss = false;
  try { await jwtVerify(idToken, JWKS, { issuer: ISSUER, audience: "some-other-app" }); }
  catch (e) { wrongAud = e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" || /audience/i.test(String(e.message)); }
  try { await jwtVerify(idToken, JWKS, { issuer: "https://evil.example.com", audience: CLIENT_ID }); }
  catch (e) { wrongIss = e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" || /issuer/i.test(String(e.message)); }
  result.checks.ac8 = wrongAud && wrongIss;
  result.evidence.ac8 = `wrong-audience rejected=${wrongAud}, wrong-issuer rejected=${wrongIss}`;

  // AC-9: replaying the SAME authorization code must not yield a second token.
  const tok2 = await exchange(code);
  logBody("token-exchange-replay", tok2.text);
  result.checks.ac9 = tok2.status !== 200 && !/("id_token"|"access_token")/.test(tok2.text);
  result.evidence.ac9 = `replay status=${tok2.status}, body=${tok2.text.slice(0, 120)}`;

  // Bonus: userinfo as a protected resource — valid access token works,
  // a missing/garbage token is 401 (supports AC-6 "401 at the resource" framing).
  const uiOk = await fetch(`${AUTHCO}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${accessToken}`, origin: AUTHCO } });
  const uiOkText = await readBody(uiOk);
  logBody("userinfo-valid", uiOkText);
  const uiBad = await fetch(`${AUTHCO}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer not-a-real-token`, origin: AUTHCO } });
  const uiBadText = await readBody(uiBad);
  logBody("userinfo-bad-token", uiBadText);
  result.evidence.userinfo = `valid=${uiOk.status}, garbage=${uiBad.status}`;
  result.steps.userinfo = `valid=${uiOk.status}, garbage=${uiBad.status}`;

  // AC-10 (consumer side): the userinfo / token bodies Notes saw carry no
  // password or hash. verify.sh does the authoritative grep across all bodies.
  result.checks.ac10_consumer = !/password|"hash"|"salt"/i.test(uiOkText + tok1.text);
  result.evidence.ac10_consumer = `userinfo keys=${Object.keys(JSON.parse(uiOkText || "{}")).join(",")}`;

  result.ok = true;
}

main()
  .catch((e) => { result.error = String(e && e.stack ? e.stack : e); })
  .finally(() => {
    writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: result.ok, checks: result.checks, error: result.error }, null, 2));
    process.exit(result.ok ? 0 : 1);
  });

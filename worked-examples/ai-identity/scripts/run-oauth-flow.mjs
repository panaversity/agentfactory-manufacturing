// Headless driver for the authorization-code + PKCE flow against AuthCo.
//
// Steps: sign in (get session) -> /oauth2/authorize -> /consent (signed
// oauth_query) -> extract code -> /oauth2/token (client_secret_basic) -> tokens.
//
// Reads CLIENT_ID / CLIENT_SECRET / REDIRECT_URI from the environment so no
// secret is ever written into the repo. Endpoints + issuer come from discovery.

import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ORIGIN = BASE;
const USER_PASSWORD = process.env.FLOW_PASSWORD ?? "flow user strong password 123";
const USER_NAME = "Flow User";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function log(...a) {
  if (process.env.FLOW_QUIET !== "1") console.error("[flow]", ...a);
}

// ---- tiny cookie jar ----
const jar = new Map();
function absorb(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function jsonPost(path, body, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "sec-fetch-mode": "cors",
      Cookie: cookieHeader(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  absorb(res);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { res, text, data };
}

export async function runOAuthFlow(opts = {}) {
  const CLIENT_ID = opts.clientId ?? process.env.CLIENT_ID;
  const CLIENT_SECRET = opts.clientSecret ?? process.env.CLIENT_SECRET;
  const REDIRECT_URI = opts.redirectUri ?? process.env.REDIRECT_URI ?? "http://localhost:3000/callback";
  const SCOPE = opts.scope ?? "openid profile email";
  const RESOURCE = opts.resource ?? null; // RFC 8707 -> JWT access token for this aud
  const ACCEPT = opts.accept ?? true; // false => exercise Deny
  // Unique user per run by default, so the consent (signed oauth_query) path is
  // genuinely exercised each time rather than short-circuited by a stored grant.
  const USER_EMAIL = opts.email ?? process.env.FLOW_EMAIL ?? `flow-${randomBytes(6).toString("hex")}@authco.test`;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("clientId/clientSecret required (opts or env)");

  // 0. discovery
  const disc = await (await fetch(BASE + "/api/auth/.well-known/openid-configuration")).json();
  const issuer = disc.issuer;
  const authorizeEndpoint = disc.authorization_endpoint;
  const tokenEndpoint = disc.token_endpoint;
  const jwksUrl = disc.jwks_uri;
  log("issuer", issuer, "client", CLIENT_ID, "scope", SCOPE);

  // 1. ensure a user exists, then sign in for a session cookie
  await jsonPost("/api/auth/sign-up/email", { name: USER_NAME, email: USER_EMAIL, password: USER_PASSWORD });
  const signin = await jsonPost("/api/auth/sign-in/email", { email: USER_EMAIL, password: USER_PASSWORD });
  if (signin.res.status !== 200) throw new Error("sign-in failed: " + signin.res.status + " " + signin.text);
  log("signed in", USER_EMAIL);

  // 2. PKCE
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));

  // 3. authorize (GET w/ cors -> JSON { redirect, url })
  const authUrl = new URL(authorizeEndpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...(RESOURCE ? { resource: RESOURCE } : {}),
  }).toString();
  const authRes = await fetch(authUrl, {
    headers: { Origin: ORIGIN, "sec-fetch-mode": "cors", Cookie: cookieHeader() },
    redirect: "manual",
  });
  absorb(authRes);
  const authText = await authRes.text();
  let authData = null;
  try { authData = JSON.parse(authText); } catch {}
  const consentUrl = authData?.url ?? authData?.redirect ?? authRes.headers.get("location");
  log("authorize ->", authRes.status, consentUrl?.slice(0, 80));
  if (!consentUrl) throw new Error("authorize gave no redirect: " + authRes.status + " " + authText);

  // The authorize step can itself reject the request (e.g. a scope the client
  // is not registered for -> error=invalid_scope). Surface that, don't throw.
  {
    const u = new URL(consentUrl, BASE);
    const authError = u.searchParams.get("error");
    if (authError) {
      log("authorize rejected ->", authError, u.searchParams.get("error_description"));
      return {
        issuer, jwksUrl, audience: CLIENT_ID, requestedScope: SCOPE,
        authorizeError: authError,
        authorizeErrorDescription: u.searchParams.get("error_description"),
        idToken: null, accessToken: null, grantedScope: null,
      };
    }
  }

  // 4. Two branches: if a prior grant exists, authorize redirects straight to
  // the client with a code; otherwise it redirects to /consent with a signed
  // querystring we must approve. (Fresh user per run normally takes branch B.)
  const consentParsed = new URL(consentUrl, BASE);
  let code = consentParsed.searchParams.get("code");
  let consentExercised = false;

  // Capture the exact scopes the signed consent query carries (FR-3/AC-9):
  // what the consent screen would render is exactly this set.
  const requestedConsentScope = consentParsed.searchParams.get("scope");

  if (!code) {
    // Branch B: the WHOLE querystring (params + ba_param list + sig) is the
    // signed blob, posted back verbatim as oauth_query.
    const oauthQuery = consentParsed.search.replace(/^\?/, "");
    if (!oauthQuery) throw new Error("no code and no signed query: " + consentUrl);

    const consent = await jsonPost("/api/auth/oauth2/consent", { accept: ACCEPT, oauth_query: oauthQuery });
    const redirectToClient =
      consent.data?.url ?? consent.data?.redirect ?? consent.res.headers.get("location");
    log("consent ->", consent.res.status, "accept=" + ACCEPT, String(redirectToClient).slice(0, 80));

    const redirParsed = redirectToClient ? new URL(redirectToClient, BASE) : null;
    code = redirParsed?.searchParams.get("code") ?? null;

    // Deny path (or any consent that yields no code): return without a token.
    if (!ACCEPT || !code) {
      return {
        issuer, jwksUrl, audience: CLIENT_ID, requestedScope: SCOPE,
        consentScope: requestedConsentScope,
        denied: !ACCEPT,
        denyStatus: consent.res.status,
        denyError: redirParsed?.searchParams.get("error") ?? consent.data?.error ?? null,
        code,
        idToken: null, accessToken: null, grantedScope: null,
      };
    }
    consentExercised = true;
  } else {
    log("consent already granted; authorize returned code directly");
  }

  if (!code) throw new Error("no authorization code obtained");
  log("got code", code.slice(0, 8) + "…");

  // 7. token exchange (client_secret_basic)
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  async function exchange(theCode) {
    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        Origin: ORIGIN,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: theCode,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        ...(RESOURCE ? { resource: RESOURCE } : {}),
      }).toString(),
      redirect: "manual",
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { res, text, data };
  }

  const tok = await exchange(code);
  log("token ->", tok.res.status, Object.keys(tok.data ?? {}).join(","));
  if (tok.res.status !== 200 || !tok.data?.id_token) {
    throw new Error("token exchange failed: " + tok.res.status + " " + tok.text);
  }

  // 8. AC-8 replay: reuse the same code -> must fail (invalid_grant)
  const replay = await exchange(code);
  const replayCode = replay.data?.error ?? null;
  log("replay ->", replay.res.status, replayCode);

  return {
    issuer,
    jwksUrl,
    audience: CLIENT_ID,
    requestedScope: SCOPE,
    consentScope: requestedConsentScope,
    grantedScope: tok.data.scope ?? null,
    consentExercised,
    idToken: tok.data.id_token,
    accessToken: tok.data.access_token ?? null,
    tokenResponseKeys: Object.keys(tok.data),
    replay: { status: replay.res.status, error: replayCode, gotSecondToken: !!replay.data?.id_token },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await runOAuthFlow();
  // print the id_token only to stdout for piping; everything else to stderr
  console.log(JSON.stringify(out));
}

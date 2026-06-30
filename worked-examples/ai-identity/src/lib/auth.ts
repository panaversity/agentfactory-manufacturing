import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { nextCookies } from "better-auth/next-js";

/**
 * AuthCo — our own identity service.
 *
 * Better Auth core gives us email/password + server-side sessions.
 * The `jwt` plugin gives us an asymmetric signing key + a public JWKS endpoint.
 * The `@better-auth/oauth-provider` plugin turns us into an OAuth 2.1 / OIDC
 * issuer: discovery doc, authorization-code flow (PKCE required by default),
 * consent, token + userinfo endpoints. With the `jwt` plugin present it signs
 * the ID token with the asymmetric JWKS key, so any client can verify it
 * offline using only the published public keys.
 *
 * Secrets (BETTER_AUTH_SECRET, the Notes client secret) come from env only.
 */
export const auth = betterAuth({
  appName: "AuthCo",
  database: new Database("./sqlite.db"),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  // Secret is read from BETTER_AUTH_SECRET; never hard-coded here.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
  plugins: [
    // Asymmetric signing key + public /jwks. We sign with RS256 ("RSA256" in
    // Better Auth's config) and bind the issuer + audience so the token matches
    // what an external resource server (the Course-17 connector) checks:
    //   iss = AuthCo, aud = the connector's RESOURCE_URL, sub = the user id.
    jwt({
      // NOTE: Better Auth docs label this "RSA256", but jose requires the JWK
      // alg to be "RS256" — using "RSA256" throws JOSENotSupported at /token.
      jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
      jwt: {
        issuer: process.env.BETTER_AUTH_URL || "http://localhost:3000",
        audience: process.env.RESOURCE_URL || "http://localhost:8000",
        expirationTime: "1h",
        getSubject: (session) => session.user.id,
      },
    }),
    oauthProvider({
      // Where AuthCo sends the browser for login / consent.
      loginPage: "/sign-in",
      consentPage: "/consent",
      // What clients may request. "openid" makes us a true OIDC server.
      scopes: ["openid", "profile", "email", "offline_access"],
      // storeClientSecret defaults to "hashed" (base64url(SHA-256(secret))).
      // We keep the default: client secrets are never stored or recoverable in
      // plaintext at rest. This closes the spike's at-rest gap.
      // PKCE is required by default (OAuth 2.1) — no extra flag needed.
      //
      // We serve OIDC discovery at /api/auth/.well-known/openid-configuration
      // (under the Next handler base). The plugin also nudges you to expose a
      // root-level /.well-known/oauth-authorization-server for MCP-style
      // clients; we don't need that here, so silence the reminder.
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
    }),
    // MUST be last: bridges Better Auth Set-Cookie into the Next.js cookie store.
    nextCookies(),
  ],
});

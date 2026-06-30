import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { cimd } from "@better-auth/cimd";
import { agentAuth } from "@better-auth/agent-auth";
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
    // CIMD (Client ID Metadata Document, IETF draft + MCP auth spec).
    //
    // Real 1.7 API: `cimd()` is a Better Auth plugin (NOT an oauthProvider
    // option). In its init() it calls extendOAuthProvider(ctx, { clientDiscovery })
    // to register a URL-`client_id` discovery on the oauth-provider above, so it
    // MUST be listed AFTER oauthProvider(). It advertises
    // `client_id_metadata_document_supported: true` in the discovery doc.
    //
    // allowLoopback lets an `http://localhost:.../client.json` client_id work
    // for local dev. In production the draft requires HTTPS client_id URLs; the
    // plugin enforces that (HTTP is accepted ONLY for loopback, ONLY when this
    // flag is set). Origin-binding (redirect_uris etc. must share the client_id
    // origin) is on by default.
    cimd({ allowLoopback: true }),
    // ---------------------------------------------------------------------
    // The frontier: AuthCo now also issues AGENT identities.
    //
    // The first half made AuthCo a human issuer (OIDC + JWKS + CIMD). Agents
    // are a different principal: each one is its OWN identity with its OWN
    // short-lived, self-signed credential — not a human's bearer token reused.
    // `@better-auth/agent-auth` implements the Agent Auth Protocol
    // (agentauthprotocol.com, v1.0-draft) — complementary to OAuth, purpose-built
    // for per-agent identity, capabilities, and lifecycle that OAuth has no
    // concept of. It coexists with the human issuer above in this one instance:
    // the two identity planes share a server but never share a credential.
    //
    // Three-tier model: a User authorizes a Host (a device/runtime), and an
    // Agent is a keypair registered under a Host. The agent proves itself with
    // a ~60s self-signed Ed25519 JWT (proof-of-possession), and AuthCo
    // authorizes each request live against the agent's active Grants.
    agentAuth({
      providerName: "AuthCo Agents",
      providerDescription: "Agent identities for the Notes domain",
      modes: ["delegated", "autonomous"],
      // Let a runtime register itself as a host by presenting an inline public
      // key. A real deployment gates this further (network ACLs, enrollment
      // tokens); for the worked example it keeps the autonomous demo to one call.
      allowDynamicHostRegistration: true,
      // Only the read capability is in a fresh host's budget, so it auto-grants.
      // Sharing and deletion always require a human decision (below).
      defaultHostCapabilities: ["read_notes"],
      // WebAuthn-strength capabilities cannot be auto-approved by a browser agent.
      proofOfPresence: { enabled: true },
      // An autonomous agent (no human owner) acts as this service principal.
      resolveAutonomousUser: async () => ({
        id: "authco-notes-service",
        email: "notes-service@authco.local",
        name: "Notes Service",
      }),
      capabilities: [
        {
          name: "read_notes",
          description: "Read the owner's notes",
          // "none" => auto-granted if within the host's budget. No human needed.
          approvalStrength: "none",
          input: {
            type: "object",
            properties: { ownerId: { type: "string" } },
          },
        },
        {
          name: "share_note",
          description: "Share a note with an external recipient",
          // "session" => a logged-in human must approve before the grant activates.
          approvalStrength: "session",
          // The agent MUST scope WHO it can share with — a value-level constraint
          // (e.g. { recipientDomain: { in: ["acme.com"] } }), richer than an
          // OAuth scope string. Enforced at execution time.
          requiredConstraints: ["recipientDomain"],
          input: {
            type: "object",
            required: ["noteId", "recipient"],
            properties: {
              noteId: { type: "string" },
              recipient: { type: "string" },
              recipientDomain: { type: "string" },
            },
          },
        },
        {
          name: "delete_all_notes",
          description: "Irreversibly delete every note",
          // "webauthn" => requires physical presence (a passkey). This stops an
          // AI agent with browser access from approving its own destruction.
          approvalStrength: "webauthn",
        },
      ],
      // The server validated the agent JWT and the grant (incl. constraints)
      // before this runs. We just do the work and, for single-use capabilities,
      // consume the grant so it cannot be replayed.
      onExecute: async ({
        capability,
        arguments: args,
        agentSession,
        revokeGrant,
      }) => {
        if (capability === "read_notes") {
          return {
            notes: ["buy milk", "ship the frontier"],
            readBy: agentSession?.agent?.id,
          };
        }
        if (capability === "share_note") {
          await revokeGrant(); // single-use: one approval, one share
          return {
            shared: args?.noteId,
            with: args?.recipient,
            status: "sent",
          };
        }
        if (capability === "delete_all_notes") {
          return { deleted: "all", status: "done" };
        }
        return { ok: true };
      },
    }),
    // MUST be last: bridges Better Auth Set-Cookie into the Next.js cookie store.
    nextCookies(),
  ],
});

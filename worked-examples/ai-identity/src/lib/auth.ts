import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { cimd } from "@better-auth/cimd";
import { agentAuth } from "@better-auth/agent-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { NOTES_RESOURCE } from "./notes-resource";

// Neon's serverless driver talks to Postgres over a WebSocket for pooled
// (transaction-capable) connections. Node 22+ ships a global WebSocket, so we
// hand it to the driver rather than pulling in the `ws` native-ish dependency.
if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket as never;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const auth = betterAuth({
  appName: "AuthCo",
  // baseURL and secret come from BETTER_AUTH_URL / BETTER_AUTH_SECRET in .env.
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
  plugins: [
    // jwt(): asymmetric signing key + public JWKS at /api/auth/jwks. Configured
    // for RS256 (spec 05) because typical resource-server verifiers (FastMCP's
    // JWTVerifier, python-jose, gateways) expect RS256, not the EdDSA default.
    // NOTE: the alg value that works with jose is "RS256" — NOT "RSA256" (which
    // Better Auth's docs show but jose rejects with JOSENotSupported -> 500).
    // GET /api/auth/token mints a session JWT bound to the resource server:
    // iss = BETTER_AUTH_URL, aud = RESOURCE_URL (RFC 8707), finite exp, sub = user id.
    jwt({
      jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
      jwt: {
        // NOTE: the spec's verified snippet also sets `issuer: BETTER_AUTH_URL`,
        // but that is (a) redundant — the jwt plugin already defaults `iss` to
        // BETTER_AUTH_URL — and (b) on 1.7.0-rc.0 it collides with the
        // oauthProvider's own issuer and 404s the discovery document (breaking
        // specs 02-04). Omitting it keeps iss=BETTER_AUTH_URL AND a healthy
        // discovery doc. The resource server expects iss = BETTER_AUTH_URL.
        audience: process.env.RESOURCE_URL, // RFC 8707: aud = the protected API's URL (FR-2)
        expirationTime: "1h",
        getSubject: (session) => session.user.id,
      },
    }),
    // oauthProvider(): turns AuthCo into an OIDC/OAuth issuer — discovery,
    // authorization-code flow with PKCE required (OAuth 2.1 default), token +
    // userinfo endpoints (FR-2). storeClientSecret defaults to "hashed" — KEEP IT,
    // so client secrets are base64url(SHA-256(secret)) at rest, never plaintext (FR-3, AC-9).
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      // Custom first-class scopes beyond OIDC (FR-1). A client can only be
      // *granted* scopes it was registered for; these just make them requestable.
      scopes: ["openid", "profile", "email", "offline_access", "notes.read", "notes.write"],
      // Register the Notes API as a protected resource (RFC 8707). A token
      // requested with `resource=<this identifier>` is issued as a JWT whose
      // `aud` is the identifier, so the resource verifies it offline via JWKS
      // and reads the granted `scope` claim (FR-5).
      resources: [
        {
          identifier: NOTES_RESOURCE,
          name: "AuthCo Notes API",
          allowedScopes: ["openid", "profile", "email", "notes.read", "notes.write"],
        },
      ],
      // NOTE (rc.0): the id-token claim contributor (extensions[].claims.idToken)
      // does not emit on this pre-release, so the ID token carries the OIDC
      // standard set (sub/iss/aud/exp/iat/...) but not name/email. A client
      // reads identity from `sub`; name/email would come from /userinfo, which
      // is itself unreliable on rc.0. Flagged, not chased — re-check at ship.
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
    }),
    // cimd(): Client ID Metadata Documents (IETF draft). A client identifies
    // itself by an HTTPS URL whose JSON metadata document AuthCo fetches on
    // demand — no pre-registration. MUST come AFTER oauthProvider() (its init()
    // calls extendOAuthProvider). allowLoopback lets a http://localhost/...json
    // client_id work for local testing; off-loopback, HTTPS is strictly enforced.
    // Advertises client_id_metadata_document_supported: true in discovery (FR-2).
    cimd({ allowLoopback: true }),
    // agentAuth(): gives an AI agent its OWN identity (beta, Agent Auth Protocol).
    // Autonomous mode = a synthetic service principal, not a person. The agent
    // generates its own Ed25519 keypair, registers its PUBLIC key, and self-signs
    // short-lived (~50s) proof-of-possession JWTs; AuthCo never issues a stealable
    // bearer token. Authority is granted capabilities (least-privilege scopes with
    // value-level constraints), checked before any action runs. One swappable
    // instantiation of the durable primitives — own credential, scope, exp, revoke.
    agentAuth({
      providerName: "AuthCo Agents",
      providerDescription: "Agent identities for the Notes domain",
      modes: ["delegated", "autonomous"],
      // proofOfPresence turns on the TOP rung of the approval ladder (spec
      // step-up-approval, FR-4). Without `enabled: true`, a capability marked
      // approvalStrength:"webauthn" would be silently granted by a plain
      // logged-in session — the step-up guardrail only fires when this is on.
      // With it on, approving a webauthn capability without a registered
      // authenticator returns { error: "webauthn_required" } + a WebAuthn
      // challenge, and grants NOTHING. rpId/origin bind the challenge to this
      // origin (loopback for local dev). The challenge cache is in-memory (no
      // migration); passkeys are read defensively (none registered => the
      // step-up cannot be completed here, which is exactly what AC-4 verifies).
      proofOfPresence: {
        enabled: true,
        rpId: "localhost",
        origin: "http://localhost:3000",
      },
      // Let an autonomous runtime register itself as a host by presenting an
      // inline public key (a real deployment would gate this with enrollment
      // tokens / network ACLs). Keeps the autonomous demo to one call.
      allowDynamicHostRegistration: true,
      // Only the read capability is in a fresh host's budget, so it auto-grants;
      // anything destructive must be granted explicitly (and won't be here).
      defaultHostCapabilities: ["read_notes"],
      // An autonomous agent (no human owner) acts as this synthetic principal.
      resolveAutonomousUser: async () => ({
        id: "authco-notes-service",
        email: "notes-service@authco.local",
        name: "Notes Service",
      }),
      capabilities: [
        {
          name: "read_notes",
          description: "Read the owner's notes",
          approvalStrength: "none", // auto-granted if within the host's budget
          input: { type: "object", properties: { ownerId: { type: "string" } } },
        },
        {
          name: "share_note",
          description: "Share a note with an external recipient (on behalf of a user)",
          // "session" => a logged-in human must APPROVE before the grant activates
          // (device-code flow). This is the heart of on-behalf-of delegation.
          approvalStrength: "session",
          // The agent must scope WHO it can share with — a value-level constraint,
          // richer than an OAuth scope string, enforced at execution time.
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
          name: "delete_note",
          description: "Delete one specific note (single-use per approval)",
          // "session" so a headless test can complete the human approval, yet the
          // grant is SINGLE-USE (consumed in onExecute) — the sensitive-grant
          // primitive of spec step-up-approval (FR-5): one action per approval,
          // the next call must be re-approved.
          approvalStrength: "session",
          // A value-level constraint scoping WHICH note this grant may delete —
          // an allow-list, enforced at execution time (FR-2/FR-3). Deleting a
          // different note is refused as constraint_violated and does NOT consume
          // the single-use grant.
          requiredConstraints: ["noteId"],
          input: {
            type: "object",
            required: ["noteId"],
            properties: { noteId: { type: "string" } },
          },
        },
        {
          name: "delete_all_notes",
          description: "Irreversibly delete every note",
          approvalStrength: "webauthn", // never auto-granted; proves least privilege
        },
      ],
      // The plugin verifies the agent JWT + grant (incl. constraints) before this
      // runs. `revokeGrant` consumes the ACTIVE grant for THIS call (sets its
      // status to "consumed") — the single-use lever (FR-5). The plugin only
      // reaches onExecute AFTER the constraint check passes, so a constraint
      // violation is refused earlier and never consumes the grant (FR-3/AC-3).
      onExecute: async ({ capability, arguments: args, agentSession, revokeGrant }) => {
        if (capability === "read_notes") {
          return { notes: ["buy oat milk", "ship the frontier"], readBy: agentSession?.agent?.id };
        }
        if (capability === "share_note") {
          // Deliberately NOT single-use: on-behalf-of delegation reuses the grant
          // until it expires or is revoked. (Do not add revokeGrant() here.)
          return {
            shared: args?.noteId,
            with: args?.recipient,
            sharedByAgent: agentSession?.agent?.id,
            onBehalfOf: agentSession?.user?.id, // the human this acts for
            status: "sent",
          };
        }
        if (capability === "delete_note") {
          // Do the action, THEN consume the grant so the next call must be
          // re-approved (single-use). Because we only get here after the
          // constraint (noteId allow-list) passed, a rejected out-of-scope call
          // never reaches this consume — the grant survives for the allowed note.
          await revokeGrant?.();
          return { deleted: args?.noteId, by: agentSession?.agent?.id, status: "done", singleUse: true };
        }
        if (capability === "delete_all_notes") {
          return { deleted: "all", status: "done" };
        }
        return { ok: true };
      },
    }),
    // nextCookies() MUST be the last plugin so Set-Cookie headers from server
    // actions are persisted.
    nextCookies(),
  ],
});

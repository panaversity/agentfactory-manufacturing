/**
 * Seed (or refresh) the registered "Notes" OAuth client in AuthCo's database.
 *
 * The new `@better-auth/oauth-provider` plugin stores clients in the
 * `oauthClient` table (the old plugin used `oauthApplication`). The
 * server-side `createOAuthClient` endpoint requires a logged-in session and
 * auto-generates a random client_id, which is great for self-service signup
 * but not for a deterministic spike where the independent Notes consumer must
 * know its own stable credentials up front. So we register the client as a
 * direct DB row with a fixed clientId/secret taken from env.
 *
 * Two things must match the plugin exactly so the token endpoint accepts us:
 *   1. `storeClientSecret` defaults to "hashed" => the column stores
 *      base64url(SHA-256(secret)) (no padding). We replicate that hash here;
 *      the plaintext secret is never stored and never logged.
 *   2. Array columns (redirectUris, scopes, grantTypes, responseTypes) are
 *      serialized by the adapter as JSON text.
 */
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

const DB_PATH = process.env.SQLITE_PATH || "./sqlite.db";
const clientId = process.env.NOTES_CLIENT_ID || "notes-app";
const clientSecret = process.env.NOTES_CLIENT_SECRET;
const redirectUri = process.env.NOTES_REDIRECT_URI || "http://localhost:4567/callback";

if (!clientSecret) {
  console.error("seed-client: NOTES_CLIENT_SECRET is required (env).");
  process.exit(1);
}

// Matches the plugin's default "hashed" storage: base64url(SHA-256(secret)), unpadded.
function hashClientSecret(secret) {
  return createHash("sha256")
    .update(secret, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const db = new Database(DB_PATH);
const now = new Date().toISOString();
const storedSecret = hashClientSecret(clientSecret);
const redirectUris = JSON.stringify([redirectUri]);
const scopes = JSON.stringify(["openid", "profile", "email", "offline_access"]);
const grantTypes = JSON.stringify(["authorization_code", "refresh_token"]);
const responseTypes = JSON.stringify(["code"]);

const existing = db.prepare("SELECT id FROM oauthClient WHERE clientId = ?").get(clientId);

if (existing) {
  db.prepare(
    `UPDATE oauthClient
       SET clientSecret = ?, redirectUris = ?, scopes = ?, grantTypes = ?, responseTypes = ?,
           tokenEndpointAuthMethod = ?, type = ?, disabled = ?, public = ?, name = ?, updatedAt = ?
     WHERE clientId = ?`,
  ).run(
    storedSecret, redirectUris, scopes, grantTypes, responseTypes,
    "client_secret_basic", "web", 0, 0, "Notes", now, clientId,
  );
  console.log(`seed-client: refreshed registered client "${clientId}" (Notes).`);
} else {
  db.prepare(
    `INSERT INTO oauthClient
       (id, clientId, clientSecret, redirectUris, scopes, grantTypes, responseTypes,
        tokenEndpointAuthMethod, type, disabled, public, name, userId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web', 0, 0, 'Notes', NULL, ?, ?)`,
  ).run(
    randomUUID(), clientId, storedSecret, redirectUris, scopes, grantTypes, responseTypes,
    "client_secret_basic", now, now,
  );
  console.log(`seed-client: registered OAuth client "${clientId}" (Notes).`);
}
db.close();

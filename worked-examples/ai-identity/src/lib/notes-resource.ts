// The protected resource's identifier (RFC 8707 resource indicator). A token
// requested for this resource is issued as a JWT with this value as `aud`, so
// the resource server can verify it offline via JWKS and read its scope.
// Shared by the issuer config (auth.ts) and the resource guard (resource.ts).
export const NOTES_RESOURCE =
  process.env.NOTES_RESOURCE_URL ?? "http://localhost:3000/api/notes";

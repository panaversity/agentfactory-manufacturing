import { auth } from "@/lib/auth";

/**
 * OIDC discovery at the ISSUER ROOT.
 *
 * In @better-auth/oauth-provider 1.7 the discovery endpoints are declared
 * SERVER_ONLY, so they are no longer exposed as HTTP routes under /api/auth.
 * Instead the plugin serves them through an `onRequest` hook that matches the
 * issuer-root path `${issuerPath}/.well-known/openid-configuration`. With an
 * issuer of http://localhost:3000 that path is `/.well-known/openid-configuration`,
 * which Next.js does not route to the Better Auth handler on its own. This
 * thin route forwards the request to `auth.handler`, letting the onRequest hook
 * answer it. (RFC 8414 / OIDC Discovery require the doc at the issuer root.)
 */
export async function GET(req: Request) {
  return auth.handler(req);
}
export const HEAD = GET;

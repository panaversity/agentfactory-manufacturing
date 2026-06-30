import { auth } from "@/lib/auth";

/** OAuth 2.0 Authorization Server Metadata (RFC 8414) at the issuer root.
 *  Same 1.7 rationale as the sibling openid-configuration route. */
export async function GET(req: Request) {
  return auth.handler(req);
}
export const HEAD = GET;

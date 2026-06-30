import { auth } from "@/lib/auth";

/**
 * A protected resource. Returns 200 + a credential-free user record when a
 * valid AuthCo session cookie is present, 401 otherwise.
 *
 * Note: Better Auth's session/user objects never include the password or its
 * hash, so the record echoed here is safe by construction. We still pick
 * explicit fields to make that guarantee obvious to a reviewer.
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(
    {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        emailVerified: session.user.emailVerified,
      },
      session: { expiresAt: session.session.expiresAt },
    },
    { status: 200 },
  );
}

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Return only safe identity fields. Better Auth never includes the password
  // hash on the user object, but we project explicitly so nothing leaks (AC-5).
  const { id, name, email, emailVerified, createdAt } = session.user;
  return NextResponse.json({
    user: { id, name, email, emailVerified, createdAt },
  });
}

import { NextResponse } from "next/server";
import { requireScope } from "@/lib/resource";

// A tiny protected resource with two actions:
//   GET  /api/notes  -> the READ  action, requires scope "notes.read"
//   POST /api/notes  -> the WRITE action, requires scope "notes.write"
// Scope is enforced from the token's GRANTED scope, refused before any work.

function deny(check: { status: number; error: string }) {
  // 401 advertises Bearer per RFC 6750; 403 names the missing scope.
  const headers =
    check.status === 403
      ? { "WWW-Authenticate": `Bearer error="insufficient_scope"` }
      : { "WWW-Authenticate": `Bearer error="invalid_token"` };
  return NextResponse.json({ error: check.error }, { status: check.status, headers });
}

export async function GET(req: Request) {
  const check = await requireScope(req, "notes.read");
  if (!check.ok) return deny(check);
  return NextResponse.json({
    action: "read",
    notes: [
      { id: 1, text: "Buy oat milk" },
      { id: 2, text: "Ship spec 03" },
    ],
    grantedScope: check.granted,
    sub: check.payload.sub,
  });
}

export async function POST(req: Request) {
  const check = await requireScope(req, "notes.write");
  if (!check.ok) return deny(check);
  return NextResponse.json({
    action: "write",
    created: { id: 3, text: "(a new note)" },
    grantedScope: check.granted,
    sub: check.payload.sub,
  });
}

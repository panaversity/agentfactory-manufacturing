import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Agent Auth discovery document — must live at the app root, even though the
// Better Auth base path is /api/auth. Agents fetch this to learn the provider's
// modes, endpoints, default_location (the JWT `aud`), and capabilities.
export async function GET() {
  const configuration = await auth.api.getAgentConfiguration();
  return NextResponse.json(configuration);
}

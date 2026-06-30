"use client";

import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

/**
 * Browser-side Better Auth client. Talks to the same origin's /api/auth/*.
 * The `oauthProviderClient` plugin mirrors the server's oauth-provider plugin
 * so the inferred client stays type-aware of the OAuth endpoints.
 */
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Same-origin: the client infers baseURL from the browser location.
});

export const { signIn, signUp, signOut, useSession } = authClient;

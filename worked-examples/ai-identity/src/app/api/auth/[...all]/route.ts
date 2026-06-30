import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Mounts every Better Auth + plugin endpoint under /api/auth/*
// (sign-up, sign-in, get-session, /jwks, /.well-known/openid-configuration,
//  /oauth2/authorize, /oauth2/consent, /oauth2/token, /oauth2/userinfo, ...).
export const { GET, POST } = toNextJsHandler(auth);

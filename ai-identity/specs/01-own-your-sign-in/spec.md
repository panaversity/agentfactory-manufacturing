# spec.md — Own your sign-in

## Goal

Stop renting login. Stand up your own email/password sign-in with real server-side sessions, and a UI a person can actually use: create an account, sign in, see a dashboard that proves who they are, sign out. This is the foundation everything else issues from.

## User Scenarios

- A new person creates an account with name, email, and a password, and lands signed in on a dashboard showing their name and email.
- A returning person signs in with email + password and reaches the same dashboard.
- A signed-in person signs out and is returned to the sign-in page; the dashboard is no longer reachable without signing in again.

## Functional Requirements

- FR-1 Better Auth core with email/password enabled, minimum password length 12, backed by the Neon Postgres at `DATABASE_URL`. Run the Better Auth schema migration.
- FR-2 A catch-all auth route mounts Better Auth under `/api/auth/*`. `nextCookies()` is the **last** plugin so sessions persist.
- FR-3 A browser auth client (`src/lib/auth-client.ts`) exposing `signIn`, `signUp`, `signOut`, `useSession`.
- FR-4 shadcn/ui pages: `/sign-up`, `/sign-in`, `/dashboard`. Dashboard shows the signed-in user's name, email, and id, with a sign-out button.
- FR-5 A protected API route (`/api/me`) returns the current user **with a session** and 401 **without** one.

## Edge Cases & Rules

- Wrong password or unknown email → sign-in fails with a clear message, no session is created.
- A password under 12 characters → sign-up is rejected before any account is created.
- Visiting `/dashboard` with no session → redirected to `/sign-in`.

## Out of Scope (this spec)

- OAuth/OIDC issuance, scopes, consent, two-factor, social login, agents. (Later specs.)

## Acceptance Criteria

Functional:

- [ ] AC-1 Sign-up via the UI creates an account and lands on `/dashboard` showing the correct name/email.
- [ ] AC-2 Sign-out clears the session; `/dashboard` then redirects to `/sign-in`.
- [ ] AC-3 Sign-in with the same credentials returns to `/dashboard` as the same user (same user id).
- [ ] AC-4 `/api/me` returns 200 + the user with a session cookie, 401 without.

Adversarial / security (a build can pass AC-1..4 and still fail these):

- [ ] AC-5 **Password never leaves the server:** no sign-up, sign-in, `/api/me`, or session response body contains the password or its hash.
- [ ] AC-6 **Weak passwords rejected:** an 11-character password is refused; no account row is created.
- [ ] AC-7 **No secrets in logs:** `DATABASE_URL` and `BETTER_AUTH_SECRET` never appear in server logs or any response body.

## Notes for the builder

- Read `.agents/skills/better-auth-best-practices` and `.agents/skills/email-and-password-best-practices` first. Use the Neon serverless adapter (no native build).
- Better Auth POST endpoints require a trusted `Origin` header; the configured `baseURL` is auto-trusted.
- Map each acceptance criterion to a check (script or manual run-through) and run it before calling this done.

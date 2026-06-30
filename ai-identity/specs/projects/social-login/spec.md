# spec.md — Social login (a second front door)

> **Project — stable (~50% milestone).** You built your own sign-in (spec 01). Now raise the stakes: add a second way in. This runs on the official, stable Better Auth social-provider support, so it is a project you can finish on your own with the skills you already have. No new standard, no beta channel.

## Goal

Add a social / OAuth provider sign-in (Google as the worked example) on top of the email/password sign-in you already own. A person can come in through either door and land in the same place: the same session, the same dashboard, the same user. The durable point is that **authentication method and identity are separate** — a user is one person whether they typed a password or clicked "Continue with Google," and your app should treat them as one account, not two.

## User Scenarios

- A new person clicks "Continue with Google," approves at Google, and lands signed in on the same dashboard an email/password user sees, as a real user in your database.
- A returning person who first signed up with email/password later clicks "Continue with Google" using the same email, and ends up on their existing account (or is asked to link), not a silent second account.
- A signed-in social user signs out and is returned to sign-in; the dashboard is no longer reachable without signing in again.

## Functional Requirements

- FR-1 Enable Better Auth's social-provider support for at least one provider (Google in the worked example). Read the `better-auth-best-practices` skill for the exact `socialProviders` config.
- FR-2 The provider's **client secret lives in env only** (`.env`, e.g. `GOOGLE_CLIENT_SECRET`). It is never in a request/response body, never in client-side code, never logged.
- FR-3 The sign-in and sign-up pages gain a "Continue with Google" button wired to the auth client's social sign-in. A successful social sign-in creates a real session and reaches `/dashboard`, the same destination as email/password.
- FR-4 A social sign-in produces a normal user + session: the dashboard reads the same `name` / `email` / `id` shape regardless of how the person signed in.
- FR-5 **Account-linking behavior is decided and stated.** Choose one and say which in the build: (a) same verified email → same user (link to the existing account), or (b) explicit linking only (a signed-in user links Google from a settings action; an unauthenticated collision is refused rather than silently merged). Whichever you pick, no silent duplicate-account-per-method.

## Edge Cases & Rules

- A person cancels at Google's consent screen → returned to sign-in with no session and a clear message, no half-created account.
- A social email that collides with an existing email/password account → handled per the FR-5 decision (linked or explicitly refused), never a silent second account and never an account takeover.
- The provider returns an **unverified** email → do not auto-link it to an existing account on email alone; treat it as unverified.

## Out of Scope (this spec)

- Adding many providers (one proves the pattern).
- Issuer / OAuth-provider concerns (specs 02-06) — here you are a **client** of Google, not an issuer.
- Two-factor on the social path (see `projects/2fa`).

## Acceptance Criteria

Functional:

- [ ] AC-1 A user can sign in with the provider and reaches the **same** `/dashboard` as an email/password user, as a real user/session.
- [ ] AC-2 The dashboard shows that user's name/email/id identically whether they came via password or via the provider.

Adversarial / security (a build can pass AC-1..2 and still fail these):

- [ ] AC-3 **Secret stays server-side:** the provider client secret appears only in env — never in any response body, client bundle, or log line.
- [ ] AC-4 **No silent duplicate / no takeover:** a social email matching an existing account behaves per the stated FR-5 rule (linked or explicitly refused). It never silently creates a second account, and an unverified provider email never auto-links onto someone else's account.
- [ ] AC-5 **Cancel is clean:** abandoning the provider consent leaves no session and no orphaned account row.

## Notes for the builder

- Read `.agents/skills/better-auth-best-practices`. This is stable Better Auth; no beta channel.
- State your account-linking choice (FR-5) out loud when you plan, and verify AC-4 by actually trying the same email through both doors — do not assume the default.
- Verify AC-3 by grepping the client bundle and the logs for the secret, not by trusting that it is "in env."

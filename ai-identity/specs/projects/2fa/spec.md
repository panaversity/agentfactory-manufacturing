# spec.md — Two-factor (harden your sign-in)

> **Project — stable (~50% milestone).** You built your own sign-in (spec 01). Now make a stolen password not enough to use it. This runs on the official, stable Better Auth two-factor support, so it is a project you can finish on your own with the skills you already have. No beta channel, no moving standard.

## Goal

Add a second factor to AuthCo sign-in so that knowing the password is not the same as being able to sign in. A user enrolls a time-based one-time code (TOTP) from an authenticator app, plus single-use backup codes for when the phone is gone. The durable primitive is **proof of possession on top of proof of knowledge**: even a fully leaked password cannot complete sign-in without the second factor, and the factor secrets are never recoverable from your storage or your logs.

## User Scenarios

- A signed-in user enrolls 2FA: they are shown a TOTP secret (as a QR code or string) once, add it to an authenticator app, and receive a set of backup codes to save.
- At the next sign-in, the user enters the right password and is then required to enter a current TOTP code before any session is issued.
- A user whose phone is unavailable signs in with the password plus one backup code; that backup code then no longer works a second time.

## Functional Requirements

- FR-1 Enable the official two-factor support (the `twoFactor` plugin; read the `two-factor-authentication-best-practices` skill). TOTP enrollment produces a secret the user adds to an authenticator app, shown once as a QR/secret.
- FR-2 After enrollment, sign-in requires the password **and** a valid current TOTP code (or a backup code) before a session is issued. Password alone yields no session.
- FR-3 A set of single-use backup codes is generated at enrollment. Each works exactly once in place of a TOTP code, then is spent and cannot be reused.
- FR-4 The TOTP secret and backup codes are stored **hashed/encrypted at rest**, are never returned after enrollment, and never appear in a log line.
- FR-5 The UI covers the full loop: an enrollment view (show secret + backup codes once), and a sign-in step that prompts for the second factor when the account has 2FA enabled.

## Edge Cases & Rules

- A correct password with a wrong, blank, or expired TOTP code → sign-in refused, no session created.
- A backup code entered a second time → refused; it was spent on first use.
- The enrollment secret and backup codes are displayed exactly once; a later request to "show them again" returns nothing recoverable (they are hashed/encrypted at rest).

## Out of Scope (this spec)

- 2FA on a social-login path (see `projects/social-login` for the social door itself).
- SMS / email OTP as a primary factor (TOTP + backup codes is the scope here).
- Issuer / agent concerns (specs 02-06 and the frontier projects).

## Acceptance Criteria

Functional:

- [ ] AC-1 A user with 2FA enabled completes sign-in with the password **and** a valid current TOTP code, and reaches the dashboard.
- [ ] AC-2 Enrollment shows the TOTP secret and backup codes once, and the authenticator-app code generated from that secret is accepted at sign-in.

Adversarial / security (a build can pass AC-1..2 and still fail these):

- [ ] AC-3 **A leaked password alone is not enough:** sign-in with the correct password and a wrong or blank TOTP is refused, and no session is created.
- [ ] AC-4 **Backup codes are single-use:** a backup code that signed in once is rejected on its second use.
- [ ] AC-5 **Secrets stay secret:** the TOTP secret and backup codes never appear in a response body or log after enrollment, and at rest they are hashed/encrypted, not plaintext.

## Notes for the builder

- Read `.agents/skills/two-factor-authentication-best-practices` (or `better-auth-best-practices` for the plugin wiring). This is stable Better Auth, not the beta agent surface.
- Keep the identity invariant from spec 01: nothing here returns or logs a secret. Verify AC-5 by inspecting the database row and the logs directly, not by assuming the default is safe.
- Verify AC-3 and AC-4 by actually trying the bad paths (right password + wrong code; reuse a spent backup code), not by reading config.

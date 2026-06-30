# spec.md — Two-factor (TOTP + backup codes)

> **Half 2 — roadmap.** A stub, lighter than specs 01-04. It hardens the human sign-in you already own before you start issuing credentials to agents. Built on the official Better Auth two-factor support, which is stable.

## Goal

Make a stolen password not enough. Add a second factor to AuthCo sign-in: a time-based one-time code (TOTP) from an authenticator app, with single-use backup codes for when the phone is gone. The durable primitive here is **proof of possession on top of proof of knowledge**, so a leaked password alone cannot sign in.

## Functional Requirements

- FR-1 Enable the official two-factor support (the `twoFactor` plugin / `two-factor-authentication-best-practices` skill). TOTP enrollment produces a secret the user adds to an authenticator app (shown once, as a QR/secret).
- FR-2 After enrollment, sign-in requires the password **and** a valid current TOTP code before a session is issued.
- FR-3 A set of single-use backup codes is generated at enrollment; each works exactly once in place of a TOTP code, then is spent.
- FR-4 The TOTP secret and backup codes are stored hashed/encrypted at rest, never returned after enrollment and never logged.

## Acceptance Criteria

- [ ] AC-1 A user with 2FA enabled cannot complete sign-in with the correct password alone; a valid TOTP (or a backup code) is also required.
- [ ] AC-2 **A leaked password is not enough:** sign-in with the right password and a wrong/blank TOTP is refused, no session created.
- [ ] AC-3 **Backup codes are single-use:** a backup code that signed in once is rejected on reuse.
- [ ] AC-4 **Secrets stay secret:** the TOTP secret and backup codes are never in a response body or log after enrollment; at rest they are hashed/encrypted, not plaintext.

## Notes for the builder

- Use the official `two-factor-authentication-best-practices` skill; this is stable Better Auth, not the beta agent surface.
- Keep the identity invariant: nothing here returns or logs a secret. Verify AC-4 by inspecting the DB and the logs, not by assuming.

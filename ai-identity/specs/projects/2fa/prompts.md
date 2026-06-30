# Project — Two-factor · uses `specs/projects/2fa/spec.md`

> A stable ~50% project. Harden the sign-in you already own so a stolen password isn't enough. This is the official Better Auth two-factor support, finishable with the skills you have.

**Build:**

> Read `specs/projects/2fa/spec.md` and the `two-factor-authentication-best-practices` skill. Plan it, show me the plan, then build it in small steps. Add TOTP enrollment and single-use backup codes, require the second factor at sign-in, and run the acceptance checks including the adversarial ones (AC-3..AC-5).

**Understand (no spec):**

> I just enabled 2FA. Try to sign me in with only my correct password and show me exactly where it stops me. Explain in plain English why knowing the password is no longer enough.

> Show me how my TOTP secret and backup codes are stored. Are they sitting there in plaintext? Prove it, and explain why you can't show them to me again after enrollment.

> Sign me in once with a backup code, then try the same code again. Show me the second attempt being refused, and explain what "single-use" is protecting against.

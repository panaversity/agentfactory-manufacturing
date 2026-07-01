# Project — Social login · uses `specs/projects/social-login/spec.md`

> A stable ~50% project. You own one front door; add a second. This is the official Better Auth social-provider support, so you can finish it with the skills you already have.

**Build:**

> Read `specs/projects/social-login/spec.md` and the `better-auth-best-practices` skill. Plan it, show me the plan — including which account-linking rule you're choosing and why — then build it in small steps. Add a "Continue with Google" button to my sign-in and sign-up pages, keep the client secret in env, and run the acceptance checks including the adversarial ones (AC-3..AC-5).

**Understand (no spec):**

> I just signed in with Google. Show me what got stored for my account and compare it to an email/password user — what's the same, what's different, and where did my password go (or not)?

> Take the same email through both doors — password first, then Google. Show me whether I ended up as one account or two, and explain the rule you implemented for that.

> Search my client bundle and my server logs for the Google client secret. Show me it isn't there, and explain why it must never leave the server.

# Reader prompts

Plain-language prompts you paste into your agent (claude.ai, Claude Code, or OpenCode). They are short on purpose — you carry the intent, the spec carries the detail, the skill carries the API. Two kinds:

- **Build prompts** drive a manufacture from a spec.
- **Understand prompts** have no spec; they make you _see_ what you just built, which is where the identity literacy actually forms.

The loop inside every build prompt is the one you already know from Spec-Driven Development: plan → build in small steps → check against the acceptance criteria.

---

## Setup (once)

> I have a Neon Postgres database. Help me put its connection string into `.env` as `DATABASE_URL`, generate a `BETTER_AUTH_SECRET`, and confirm the app boots with `pnpm dev` and the landing page loads. Don't touch auth yet.

---

## Lesson 1 — Own your sign-in · uses `specs/01-own-your-sign-in/spec.md`

**Build:**

> Read `specs/01-own-your-sign-in/spec.md` and the `better-auth-best-practices` and `email-and-password-best-practices` skills. Plan the approach against our constitution, show me the plan, then build it in small steps. Run the spec's acceptance checks — including the security ones (AC-5..AC-7) — before you call it done.

**Understand (no spec):**

> I just signed up. Show me exactly what got stored in the database for my account, and point out what is NOT there — where's my password, and why can't you show it to me?

> Try to reach `/dashboard` and `/api/me` without signing in, and show me what happens. Explain in plain English what is stopping you.

---

## Lesson 2 — Become the issuer · uses `specs/02-become-the-issuer/spec.md`

**Build:**

> Read `specs/02-become-the-issuer/spec.md` and the `agent-identity-issuer` skill. Plan it, show me the plan, then build it in small steps. Build the token verifier as a separate script so the checks are real, and run all the acceptance criteria — especially the adversarial ones (AC-4..AC-9).

**Understand (no spec):**

> Fetch my JWKS endpoint and show me what's there. Is my private signing key in it? Prove it, and explain why a stranger can verify my tokens but can't forge one.

> Take an ID token you just issued, decode it, and walk me through every claim — `iss`, `aud`, `sub`, `exp` — in plain English. Then change the `aud` by one character and show me the verifier rejecting it.

> Issue a token, then move the clock past its expiry and try to use it. Show me the exact rejection.

---

## Lesson 3 — Scopes & consent · uses `specs/03-scopes-and-consent/spec.md`

_(prompts land with the spec)_

## Lesson 4 — Connect a real app · uses `specs/04-connect-a-real-app/spec.md`

_(prompts land with the spec — this is where a separate app signs in with AuthCo)_

## Half 2 (roadmap) — agent credential, on-behalf-of, human approval · `specs/roadmap/`

_(on `@better-auth/agent-auth`, beta — taught as one instantiation of the durable primitives)_

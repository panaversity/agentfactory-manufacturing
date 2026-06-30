# AuthCo — the AI Identity base

This is the starting point for the **AI Identity** crash course. You clone it, and you build your own identity service by directing an agent — one spec at a time. You will not hand-write the auth code; you will manufacture it from the specs in `specs/`, the way you learned in the Spec-Driven Development course.

By the end you own a real **identity issuer**: people sign in, and your server hands _other_ apps signed tokens they can verify on their own. Then you give an AI worker its own bounded, revocable, on-behalf-of credential.

## What's already here (the canvas — don't rebuild it)

- A booting Next.js + Tailwind + **shadcn/ui** app (neutral landing page, no auth yet).
- Better Auth + `@better-auth/oauth-provider` + the Neon driver, **installed**.
- The expertise the agent needs in `.agents/skills/` (official Better Auth skills + our `agent-identity-issuer` skill).
- The **specs** you'll build from, and the **prompts** you'll paste, in `specs/` and `prompts/`.

## What you build (the manufacturing arc)

| #   | Spec                           | You end up with                                                                                                             |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-own-your-sign-in`          | Email/password sign-in, sessions, and a real sign-in/up/dashboard UI                                                        |
| 2   | `02-become-the-issuer`         | An OIDC issuer: discovery, JWKS, the authorization-code flow                                                                |
| 3   | `03-scopes-and-consent`        | Least-privilege scopes + a consent screen you approve                                                                       |
| 4   | `04-connect-a-real-app`        | A separate app signs in **with AuthCo** and verifies your tokens via JWKS only                                              |
| 5   | `05-connect-a-resource-server` | A protected API / MCP gateway validates your RS256 access tokens offline (audience-bound, RFC 8707)                         |
| 6–8 | `specs/roadmap/`               | (Half 2) An agent gets its own credential, on-behalf-of authority, and human approval — on `@better-auth/agent-auth` (beta) |

## Setup (once)

1. Provision a free Neon Postgres database (or use the Neon MCP) and copy its connection string.
2. `cp .env.example .env`, then fill in `DATABASE_URL` and generate `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
3. `pnpm install` then `pnpm dev` → the landing page should load at http://localhost:3000.

## How to build a spec

Open the lesson, paste its prompts (in `prompts/PROMPTS.md`). The shape is always the same loop you already know:

> Read `specs/02-become-the-issuer/spec.md`. Plan the approach against our constitution and the `agent-identity-issuer` skill, show me the plan, then build it in small steps and run the spec's acceptance checks.

The acceptance checks in each spec are the point: they include the **security** gates a working-but-insecure build would fail. Verifying them is the skill this course teaches.

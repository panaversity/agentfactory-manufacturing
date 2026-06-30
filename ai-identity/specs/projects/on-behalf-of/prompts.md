# Project — On-behalf-of · uses `specs/projects/on-behalf-of/spec.md`

> A Half-2 frontier project on `@better-auth/agent-auth` (beta). The credential most worth getting right: the agent acts FOR a person, but only with that person's explicit, bounded, revocable say-so — no impersonation, no standing key, no grant without a human in the loop. A verified answer key lives in `worked-examples/ai-identity/`.

**Build:**

> Read `specs/projects/on-behalf-of/spec.md` and `.agents/skills/agent-identity-issuer/`. Confirm the live agent-auth surface against the Better Auth docs MCP first — it's beta. Plan it, show me the plan, then build in small steps: enable delegated mode, have an agent request a scoped capability, gate it behind human device-code approval, and only then let it act. Run every acceptance check, including no-approval-no-grant and revocation (AC-1, AC-4).

**Understand (no spec):**

> Have my agent request the right to act for me, then stop before I approve. Show me that it has nothing yet — no token, no access. Explain why "human in the loop" means the approval is the thing that mints authority, not a formality after it.

> Approve a delegated grant, then show me the token. Point out where it says both the agent AND that it's acting on behalf of me. Explain why this is delegation, not impersonation, and why that distinction matters for an audit trail.

> Revoke the delegation I gave my agent, then have it try its next on-behalf-of call. Show me it failing. Explain why I, the human, must be able to pull authority back at any moment.

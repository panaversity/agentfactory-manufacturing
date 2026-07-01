# Project — Step-up & constraints · uses `specs/projects/step-up-approval/spec.md`

> A Half-2 frontier project on `@better-auth/agent-auth` (beta). It takes the agent identity you built and makes its authority tight: least-privilege capabilities, value-level constraints, and a human gate that gets harder as the action gets more dangerous. A verified answer key lives in `worked-examples/ai-identity/`.

**Build:**

> Read `specs/projects/step-up-approval/spec.md` and `.agents/skills/agent-identity-issuer/`. Confirm the live agent-auth surface against the Better Auth docs MCP first — it's beta. Plan it, show me the plan, then build in small steps: three capabilities across the approval ladder (auto / session / physical-presence), one with a required value-constraint, and a single-use grant. Run every acceptance check, including the adversarial ones (AC-3, AC-4).

**Understand (no spec):**

> Give my agent a capability to share notes, but only with `@acme.com`. Then have it try to share with `@evil.com` and show me exactly where the server refuses it. Explain why a value-constraint is stronger than an on/off scope.

> Try to approve the "delete everything" capability for my agent using just my logged-in session. Show me the server demanding physical presence instead of granting it, and explain what that step-up is protecting against when the agent itself has a browser.

> Have my agent use a single-use grant once, then try the same action again. Show me the second call being refused, and explain why a payment-like action should consume its grant.

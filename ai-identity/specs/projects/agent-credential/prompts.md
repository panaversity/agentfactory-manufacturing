# Project — Agent credential · uses `specs/projects/agent-credential/spec.md`

> A Half-2 frontier project on `@better-auth/agent-auth` (beta). Until now every token stood for a human; here the agent is the subject. It gets its OWN short-lived, scoped, revocable credential (autonomous mode), so its actions are attributable to it, not borrowed from a person's session. A verified answer key lives in `worked-examples/ai-identity/`.

**Build:**

> Read `specs/projects/agent-credential/spec.md` and `.agents/skills/agent-identity-issuer/`. Confirm the live agent-auth surface against the Better Auth docs MCP first — it's beta. Plan it, show me the plan, then build in small steps: enable autonomous agent identity, register an agent under a host, have it self-sign its own short-lived credential, and execute a granted capability. Run every acceptance check, including replay and revocation (AC-3, AC-4).

**Understand (no spec):**

> Register an autonomous agent and show me the credential it gets. Whose identity is the `sub` — a person's, or the agent's own? Explain in plain English why the agent having its own identity is different from it reusing my login.

> Take my agent's credential, replay the exact same signed token twice, and show me the second call being refused. Explain what the `jti` is doing and why a short-lived self-signed token is safer than a long-lived bearer.

> Revoke my agent, then have it try its next call. Show me it failing, and explain why revocation has to bite on the very next request rather than whenever a cached grant expires.

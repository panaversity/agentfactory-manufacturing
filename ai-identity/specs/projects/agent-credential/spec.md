# spec.md — An agent gets its own credential

> **Half 2 — roadmap.** A stub, lighter than specs 01-04. Built on `@better-auth/agent-auth`, which is **BETA, the standard is still moving**. Treat the specific API below as **one swappable instantiation** of the durable primitives (own credential, least-privilege scope, finite expiry, revocable), not the final word. When the standard settles, the primitives stay; only the calls change.

## Goal

Give an AI worker an identity of its own. Until now every token has stood for a human. Here the agent is the subject: it gets its **own** short-lived, scoped, revocable credential (autonomous mode, a synthetic user that is not a person), so its actions are attributable to _it_ and bounded by _its_ grant, not borrowed from a human's session. The durable point is that an agent is a first-class principal with the same constraints as any other: narrow scope, finite expiry, real revocation.

## Functional Requirements

- FR-1 Enable agent identity in **autonomous** mode (in the verified beta: `agentAuth({ providerName, modes: ["autonomous"], ... })`). The agent registers and is issued its own credential, not a human's.
- FR-2 The agent's authority is expressed as **capabilities** (named actions, optionally with JSON-Schema input), which act as least-privilege scopes. The agent gets only the capabilities it was granted.
- FR-3 Issued tokens are **short-lived JWTs** whose `aud` matches the URL being called, carrying a `capabilities` claim and a `jti` for replay protection.
- FR-4 Verification happens outside the work: `verifyAgentRequest(request, auth)` (or `auth.api.getAgentSession`) confirms the agent, its capability grants, and the host before any action runs.
- FR-5 The credential is revocable: revoking the agent or its grant makes the next call fail.

## Acceptance Criteria

- [ ] AC-1 The agent obtains its **own** credential (its subject is the agent/synthetic user, not a human user id).
- [ ] AC-2 **Least privilege holds:** the agent can invoke a capability it was granted and is refused a capability it was not, with no way to widen its own grant.
- [ ] AC-3 **Tokens expire and resist replay:** an agent token past its short `exp` is rejected, and a replayed `jti` is refused.
- [ ] AC-4 **Revocation bites:** after revoking the agent or its capability grant, the very next call fails rather than succeeding on a cached grant.

## Notes for the builder

- Read `.agents/skills/agent-identity-issuer/` section 4. The agent discovers the provider at `/.well-known/agent-configuration`, registers, and requests capability grants.
- This is the beta surface: pin the version, and frame it to the reader as one instantiation of the primitives. If the API has moved, keep the acceptance criteria (own credential, least-privilege capability, finite expiry + replay protection, revocable) and re-map the calls.

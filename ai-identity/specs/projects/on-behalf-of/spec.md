# spec.md — On-behalf-of (delegated authority)

> **Half 2 — frontier.** Built on `@better-auth/agent-auth`, which is **beta, the standard is still moving**. A **verified worked example exists** (`worked-examples/ai-identity/` — the delegated + device-code approval flow in `agent-consumer/`, proven by `agent-verify.sh`), so this is buildable, not a sketch. The specific API is **one swappable instantiation** of the durable primitives (delegated on-behalf-of authority, least-privilege scope, finite/time-boxed expiry, human approval, revocable). Keep the primitives; expect the calls to change.

## Goal

Let an agent act for a person, but only with that person's explicit, bounded say-so. This is the credential most worth getting right: the agent does not impersonate the human and does not get a standing key. It holds a **delegated** grant that is scoped to specific actions, time-boxed, revocable, and only minted after the human approves in the loop. The durable point is on-behalf-of authority with consent at its center, the human stays the source of the authority and can pull it back.

## Functional Requirements

- FR-1 Enable **delegated** mode (in the verified beta: `agentAuth({ modes: ["delegated"], ... })`). A delegated grant ties the agent's authority to a specific human user.
- FR-2 The grant is **least-privilege**: limited to named capabilities (scopes), never a blanket "act as the user."
- FR-3 The grant is **time-boxed**: a finite expiry, after which the agent must seek approval again.
- FR-4 The grant requires **human approval in the loop** before issue (in the beta, `approvalMethods: ["device_authorization", "ciba"]`, the user approves via a device flow or CIBA push). No approval, no grant.
- FR-5 The grant is **revocable** by the human at any time; revocation takes effect on the next call.

## Acceptance Criteria

- [ ] AC-1 No delegated token is issued until the human explicitly approves the request (device flow or CIBA); skipping approval yields nothing.
- [ ] AC-2 **Bounded authority:** the agent can do only the capabilities the human approved, on behalf of that specific user, and nothing wider.
- [ ] AC-3 **Time-boxed:** past the grant's expiry the delegated token is rejected and re-approval is required; there is no standing, non-expiring delegation.
- [ ] AC-4 **Human can revoke:** after the user revokes the delegation, the agent's next on-behalf-of call fails.
- [ ] AC-5 **Not impersonation:** the action is attributable to the agent acting _for_ the user (the token shows both the agent and the on-behalf-of user), not to the user acting alone.

## Notes for the builder

- Read `.agents/skills/agent-identity-issuer/` section 4. Delegated grants carry both the agent and the on-behalf-of user; the human approval step is the heart of this spec, do not stub it out.
- Beta surface: pin the version and frame the API as one instantiation. If the calls have moved, keep the acceptance criteria (human-approved, scoped, time-boxed, revocable, attributable to the agent-for-user pair) and re-map.

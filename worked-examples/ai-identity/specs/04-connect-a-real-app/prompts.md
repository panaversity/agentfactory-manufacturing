# Reader prompts — Connect a real app

Paste these into your agent (claude.ai, Claude Code, or OpenCode). Short on purpose: you carry the intent, the spec carries the detail, the skill carries the API.

---

## Build · uses `specs/04-connect-a-real-app/spec.md`

> Read `specs/04-connect-a-real-app/spec.md` and the `agent-identity-issuer` skill (the register-a-client and verify-a-token sections). Plan the approach against our constitution, show me the plan, then build it in small steps. Keep Notes a fully separate process. Run the spec's acceptance checks, especially the adversarial ones (AC-4..AC-8), before you call it done.

---

## Understand (no spec)

> Show me everything Notes knows about AuthCo. Prove it has no copy of `BETTER_AUTH_SECRET` and no path into AuthCo's database, then explain how it can still verify my tokens.

> Take a token Notes just verified and change its `aud` by one character. Show me Notes's verifier rejecting it, and explain why that one character is the whole point.

> Sign me in through Notes, then revoke the client at AuthCo. Make Notes's next call and show me it fails. Explain what "revocable" actually buys me here.

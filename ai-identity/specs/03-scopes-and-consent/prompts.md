# Reader prompts — Scopes & consent

Paste these into your agent (claude.ai, Claude Code, or OpenCode). Short on purpose: you carry the intent, the spec carries the detail, the skill carries the API.

---

## Build · uses `specs/03-scopes-and-consent/spec.md`

> Read `specs/03-scopes-and-consent/spec.md` and the `agent-identity-issuer` skill. Plan the approach against our constitution, show me the plan, then build it in small steps. Run the spec's acceptance checks, especially the adversarial ones (AC-5..AC-9), before you call it done.

---

## Understand (no spec)

> Issue me a token that has only `notes.read`. Now use it to try the write action and show me the exact refusal. Then explain in plain English why a token that signs fine can still be turned away here.

> Walk me through the `/consent` screen for a client asking for `notes.read` and `notes.write`. Where do those two lines come from? Prove the screen can only show what the signed request actually asks for, not whatever it likes.

> Register a client for `notes.read` only, then have it ask for `notes.write` anyway. Show me the granted scope in the token it gets back and point out what is missing, and why.

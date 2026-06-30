# Lesson 5 — Connect a resource server · uses `specs/05-connect-a-resource-server/spec.md`

**Build:**

> Read `specs/05-connect-a-resource-server/spec.md` and the `agent-identity-issuer` skill (sections 1 and 3). Plan it, show me the plan, then build it in small steps. Configure AuthCo to sign RS256 tokens audience-bound to my API, stand up a tiny protected resource that verifies offline via JWKS, and run all the acceptance checks including the adversarial ones (AC-3..AC-6).

**Understand (no spec):**

> Show me two tokens side by side: the ID token from the login flow (lesson 4) and the access token a resource server gets. Point at the `aud` on each and explain in plain English why they're different.

> Sign a token with EdDSA and present it to my RS256-only verifier. Show me the exact rejection, then explain why the issuer's signing algorithm has to match what the consumer expects.

> Change the audience on a valid token to a different API's URL and show my resource server refusing it, even though AuthCo's signature is genuine.

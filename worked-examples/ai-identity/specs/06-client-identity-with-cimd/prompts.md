# Lesson 6 — Client identity with CIMD · uses `specs/06-client-identity-with-cimd/spec.md`

> This is the edge of the core spine. It runs on a pre-release plugin and a draft standard, so the first move is to check the live docs, not to start coding.

**Build:**

> Read `specs/06-client-identity-with-cimd/spec.md` and section 2 of the `agent-identity-issuer` skill. Before writing anything, query the live Better Auth docs MCP at `https://mcp.better-auth.com/mcp` and show me the current `@better-auth/cimd` API — whether I add `cimd()` or pass `cimdClientDiscovery()` to `oauthProvider`, and the exact discovery key. Then plan it, show me the plan, move us to the Better Auth 1.7 pre-release channel, and build it in small steps. Run the acceptance checks including the adversarial ones (AC-4..AC-7).

**Understand (no spec):**

> Show me my discovery document before and after this change, and point at the one new line that tells a client "you can identify yourself by URL." Explain in plain English what that flips on.

> Walk me through what happens when a client hands you an HTTPS URL as its `client_id`: what do you fetch, what do you read in that document, and how is that different from looking up a row in my database?

> Hand my issuer a `client_id` that is a plain `http://` URL, and one with a `#fragment` on the end. Show me each one being refused, and explain why the draft insists on a clean HTTPS URL.

> Take a metadata document that lists one `redirect_uri`, then ask to be sent to a different one. Show me the request being rejected, and explain why the document, not the request, gets the final say.

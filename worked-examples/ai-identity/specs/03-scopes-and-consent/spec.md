# spec.md — Scopes & consent

## Goal

Make authority narrow and visible. So far a client either gets a token or it doesn't. Now a token says exactly what it may do, the person sees that list before they approve, and a protected resource turns away any call whose token lacks the right scope. This is least privilege made real: the credential carries the narrowest authority that does its job, and that authority is checked on every call, not just printed once at issue time.

## User Scenarios

- A client asks AuthCo for `notes.read` only. The person is shown a consent screen naming that one permission, approves, and the client receives a token scoped to reading.
- A different client asks for `notes.read` and `notes.write`. The consent screen lists both. The person approves, and the token may now read and write.
- A person on the consent screen reads what is being requested and clicks **Deny**. No token is issued and the client is sent back empty-handed.
- A request that arrives at the write-protected action with a read-only token is refused, even though the token is otherwise valid and unexpired.

## Functional Requirements

- FR-1 Custom scopes beyond `openid`: at minimum `notes.read` and `notes.write` are defined in the `oauthProvider` `scopes` list, alongside the OIDC scopes. They are first-class, requestable scopes.
- FR-2 A registered client only carries the scopes it was registered for. A client registered for `notes.read` cannot be granted `notes.write`, even if its authorize request asks for it.
- FR-3 The `/consent` screen renders the **exact** set of scopes the current request is asking for (parsed from the signed `oauth_query`), with a human-readable line per scope and an **Approve** and a **Deny** control.
- FR-4 Approve POSTs `{ accept: true, oauth_query }` to `/api/auth/oauth2/consent` and the flow completes with a code. Deny ends the flow with no authorization code and therefore no token.
- FR-5 A protected resource enforces scope per action: a read action requires `notes.read`, a write action requires `notes.write`. The resource reads the token's **granted** scope (not the requested scope) and refuses any call missing the required one with 403 (or 401 for a missing/invalid token), never 200.
- FR-6 The token's granted scope reflects what was registered and consented to, the intersection of (requested) ∩ (registered) ∩ (approved), never more.

## Edge Cases & Rules

- A client asks for a scope it was not registered for → that scope is dropped or the request is rejected; it never appears in the granted token.
- A token valid for `notes.read` calls a `notes.write` action → refused (403/401), not 200.
- Consent denied → no code, no token; a retry must go through consent again.
- A token with no `notes.*` scope at all calls either protected action → refused.
- The consent screen must show the scopes actually in the signed `oauth_query`, not a hard-coded list, so it cannot drift from what is really being granted.

## Out of Scope (this spec)

- Connecting a fully separate external app end-to-end (spec 04).
- Refresh-token rotation, dynamic client registration, two-factor, agents (later specs / half 2).

## Acceptance Criteria

Functional:

- [ ] AC-1 `notes.read` and `notes.write` are advertised as supported scopes (visible in the discovery document's `scopes_supported`).
- [ ] AC-2 An authorize request for `notes.read` drives the browser to `/consent`, which displays a line naming `notes.read` (and nothing the request did not ask for), with Approve and Deny.
- [ ] AC-3 Approving yields a token whose granted scope includes `notes.read`; the read action returns 200 with that token.
- [ ] AC-4 A token granted `notes.read notes.write` can both read (200) and write (200).

Adversarial / security (a build can pass AC-1..4 and still fail these):

- [ ] AC-5 **Scope is enforced, not decorative:** a token granted only `notes.read` calling the `notes.write`-protected action is refused with 403 (or 401), never 200.
- [ ] AC-6 **No scope escalation at registration:** a client registered for `notes.read` only cannot obtain `notes.write`; requesting it does not put `notes.write` in the granted token.
- [ ] AC-7 **Deny issues nothing:** clicking Deny (or POSTing `accept: false`) returns no authorization code, and no token can be exchanged for that request.
- [ ] AC-8 **Missing/invalid token is 401:** the protected actions return 401 to a request with no Bearer token or a garbage token, not 200 and not a 500.
- [ ] AC-9 **The screen cannot lie:** the consent screen's displayed scopes are parsed from the request's signed `oauth_query`, so they match exactly what approval will grant (no extra scope is granted that the screen did not show).

## Notes for the builder

- Read `.agents/skills/agent-identity-issuer/` first. Custom scopes are added to the `oauthProvider({ scopes: [...] })` array and to each client's registered `scopes` (the `scopes` column for a deterministic DB-row client; see spec 02's registration caveat).
- The consent state is a **signed `oauth_query`** string, not a `consent_code`. `/oauth2/authorize` redirects to `/consent` with that query; the consent page parses `scope` out of it to render the list, then hands the whole signed string back to `/api/auth/oauth2/consent`. Do not reconstruct or mutate the scope list on the page; only display what the signed query carries.
- For enforcement at the resource, read the **granted** scope from the token, not the URL's requested scope. Two verified ways: decode the access token's `scope` claim, or call the issuer's `/api/auth/oauth2/introspect`. Refuse before doing any work if the required scope is absent.
- Build at least two clients (or two authorize requests): one scoped `notes.read`, one scoped `notes.read notes.write`, so AC-5 and AC-6 are real and not self-asserted.
- Map each acceptance criterion to a check (script or manual run-through) and run it before calling this done.

# Projects — build these yourself

You have just finished the **core spine**: you own your sign-in (01), you became an issuer (02), you scoped and got consent (03), a real app signed in with you (04), a resource server verified your tokens offline (05), and a client identified itself by URL with CIMD (06). That is the whole stable arc of being an identity provider, end to end.

This is the **~50% milestone**. From here the course stops handing you fully specified, live-verified specs and starts handing you **projects you drive yourself**. The acceptance criteria are still here, including the adversarial security gates, but the build is yours. This is on purpose: you have done the loop enough times that you can manufacture from a spec without hand-holding.

The projects come in three tiers, by how settled the ground is under them:

| Tier         | Project                                       | Runs on                                                             | When                                                  |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| **Stable**   | `2fa`, `social-login`                         | Official, stable Better Auth                                        | Do these now, at ~50%                                 |
| **Edge**     | `06-client-identity-with-cimd` (on the spine) | `@better-auth/cimd`, the 1.7 pre-release channel + a draft standard | You just did it — that was the step onto the frontier |
| **Frontier** | `agent-credential`, `on-behalf-of`            | `@better-auth/agent-auth`, **beta** — the standard is still moving  | Half 2, where agents get identity                     |

**Stable** projects are the natural next move at the halfway mark. You built sign-in; now you raise the stakes on it without leaving solid ground:

- **`2fa`** — add a second factor so a stolen password is not enough to sign in.
- **`social-login`** — add a second front door (Google) that lands on the same account and dashboard.

**Edge** is spec `06` itself, back on the core spine: it is where the course first stepped off stable ground onto a pre-release plugin (`@better-auth/cimd`) and an IETF draft. You confirm the live surface against the Better Auth docs MCP before building, because it moves.

**Frontier** is Half 2: an agent gets its **own** credential (`agent-credential`) and acts **on behalf of** a human under bounded, revocable, human-approved authority (`on-behalf-of`). These run on `@better-auth/agent-auth`, which is beta — you treat the specific API as one swappable instantiation of the durable primitives, and pin the version.

---

## The 50% project, as a card

This is how the stable milestone is offered to the reader in the course — one card, the tool is done, now raise the stakes:

```mdx
<ProjectCard
  number="P1"
  emoji="🔐"
  title="Harden your sign-in: add 2FA and a social login"
  tagline="The login works. Now make it hard to steal and easy to enter."
  time="2-3 hours"
>
  You already own a working sign-in. A working sign-in is also a target: one
  leaked password and someone is in. So raise the stakes from both sides. Add a
  second factor so a stolen password alone gets nobody anywhere, then add a
  second front door so a person can come in with Google and still land on the
  same account. Same skills you already have, real adversarial gates to pass.

> Read `specs/projects/2fa/spec.md` and `specs/projects/social-login/spec.md`.
> Plan both against our constitution and the Better Auth skills, show me the
> plan, then build them in small steps. Run every acceptance check, including
> the adversarial security ones, before you call it done.

**Done when:** a correct password with a wrong second factor is refused, a
backup code works exactly once, "Continue with Google" lands on the same
dashboard as an email/password user, and no secret ever shows up in a body or
a log.

</ProjectCard>
```

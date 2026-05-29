# Course Seven export (read-only)

This folder is Maya's accumulated approval history from Courses Five through Seven: the raw record
of decisions she made as `owner_human` on her Paperclip company. **Decision 2 imports it** to give
Claudia a starting model of Maya's judgment instead of making her learn from zero.

## Do not edit

The lab treats everything under `course-seven-export/` as a read-only input. Modifying this data
invalidates the lab: Claudia's seeded patterns would no longer reflect a real history. (The agent
loads it into Claudia's OpenClaw session as durable context; it is never written back to.)

## `approvals.json`

A representative sample of Maya's past approval decisions. The Course 8 page narrates a full
history of ~200 decisions; this file ships a smaller, well-distributed slice so the import in
Decision 2 has real data to work against. Each entry is one decision Maya resolved herself:

| Field             | Meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `approval_id`     | The original Paperclip approval id                                             |
| `type`            | `refund` / `budget_override` / `hire` / `termination`                          |
| `amount_cents`    | The amount at stake (0 for non-monetary decisions like terminations)           |
| `context`         | The decision context Maya saw (account age, prior refunds, reason, role, etc.) |
| `decision`        | What Maya did: `approve` / `decline` / `request_revision`                      |
| `comment`         | Maya's note, if she left one (most fast approvals have none)                   |
| `latency_minutes` | How long Maya took to resolve it (a proxy for how routine it felt)             |
| `resolved_at`     | Timestamp                                                                      |

The shape of this data is what Claudia learns from: which bands Maya clears fast and silently,
where she slows down and comments, and what she declines outright.

# Course Seven export (read-only)

This folder is your accumulated approval history from Courses Five through Seven: the raw record
of decisions you made as `owner_human` on your Paperclip company. **Decision 2 imports it** to give
Claudia a starting model of your judgment instead of making her learn from zero.

## Do not edit

The lab treats everything under `course-seven-export/` as a read-only input. Modifying this data
invalidates the lab: Claudia's seeded patterns would no longer reflect a real history. (The agent
loads it into Claudia's OpenClaw session as durable context; it is never written back to.)

## `approvals.json`

A representative sample of your past approval decisions. The Course 8 page narrates a full
history of ~200 decisions; this file ships a smaller, well-distributed slice so the import in
Decision 2 has real data to work against. Each entry is one decision you resolved yourself:

| Field             | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `approval_id`     | The original Paperclip approval id                                            |
| `type`            | `refund` / `budget_override` / `hire` / `termination`                         |
| `amount_cents`    | The amount at stake (0 for non-monetary decisions like terminations)          |
| `context`         | The decision context you saw (account age, prior refunds, reason, role, etc.) |
| `decision`        | What you did: `approve` / `decline` / `request_revision`                      |
| `comment`         | Your note, if you left one (most fast approvals have none)                    |
| `latency_minutes` | How long you took to resolve it (a proxy for how routine it felt)             |
| `resolved_at`     | Timestamp                                                                     |

The shape of this data is what Claudia learns from: which bands you clear fast and silently,
where you slow down and comment, and what you decline outright.

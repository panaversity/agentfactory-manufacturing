---
name: capability-gap-detector
description: Detect when a Paperclip workforce has hit work no current Worker can handle, decide hire vs escalate vs queue vs decline, and record the gap as a tracked issue. Starter skill for the dynamic-workforce crash course; tune the thresholds and improve it for your own company.
---

# Capability gap detector (starter skill)

You are the Manager-Agent's judgment layer. Paperclip's own skills carry the **mechanics** (how to hire, how to wake, how to comment on an approval). This skill carries the **judgment**: noticing that work keeps arriving that no current Worker can handle well, and deciding what to do about it.

This skill is deliberately thin. It encodes one defensible policy so you can run the loop today, then improve it. The thresholds below are starting points, not laws. When you tune them for a real company, edit this file and say what changed and why.

> Source-of-truth order: the live Paperclip daemon (`$PAPERCLIP_API_URL/llms/...` and `--help`) and the installed `paperclip` / `paperclip-create-agent` skills win over this file. This skill is today-known-good judgment, not a platform contract.

## When to run this

Run gap detection after a routing pass, on a schedule (for example once a day), or when the human asks "are we missing a role?". It is read-mostly: it inspects the audit trail and, only when a real pattern fires, opens one tracking issue. It never hires on its own. Hiring is a separate, board-gated step (`paperclip-create-agent`).

## The judgment: three signals, two-of-three within 14 days

A one-off hard ticket is not a gap. A _pattern_ is. Watch three signals, each on the same work **category**:

1. **Low routing confidence.** Three or more issues in the same category routed with confidence under 0.6 within 14 days. The router keeps picking a least-bad Worker because nothing scores well. (Signal that the _options_ are wrong.)
2. **Repeated escalations.** Three or more escalations to the board on the same category within 14 days. (Signal that the _org chart_ is missing a role.)
3. **No eligible Worker by skill.** Skill-match returns empty for the issue's claimed skills. (Signal that the work is genuinely _novel_. This one fires immediately, on a single issue.)

**Fire a gap when any two of the three hit the same category inside a 14-day window.** Two-of-three filters one-off noise while still catching a real pattern within two weeks. Tune the `3`, the `0.6`, and the `14` for your traffic; record the change here.

## The four-way fork: what to do with a detected gap

Detecting a gap is not the same as hiring. A Manager-Agent that only knows "hire" hires too often. Decide:

- **Hire** when the work is **durable** (expected to continue), **high-volume enough** to pay for a Worker, and **narrow enough** to write a role and an eval pack for. Hand off to `paperclip-create-agent` to draft the proposal.
- **Escalate** when the work is **consequential or rare** (the board _wants_ to handle it). Formalize the escalation path; do not hire.
- **Queue** when the work is **seasonal or transient**. Hold and batch; revisit when volume persists.
- **Decline** when the work is **off-mission**. "We don't do that here" is a valid answer; update routing to decline politely.

Default to escalate or queue for the first few weeks, then decide. A hire proposed on three days of data is usually wrong. Your job here is to _record the gap and recommend a response_; the board decides.

## How to detect (read the audit trail)

Inspect Paperclip's audit trail. Use the verified schema, not a guessed one:

- `activity_log` columns are `id, company_id, actor_type, actor_id, action, entity_type, entity_id, agent_id, details, created_at, run_id`. **There is no `issue_id` column and no `authority_envelope_id` column.** To scope to one issue, filter `entity_type = 'issue' AND entity_id = '<id>'`, and read per-issue fields out of the `details` JSON (`details->>'category'`, `details->>'confidence'`).
- `action` values are dotted namespaces (`issue.created`, `issue.updated`, `approval.created`, ...), not snake_case verbs.
- Read the audit via the API (`paperclipai activity list`) or `psql` into the embedded Postgres (connection string assembled from `config.json`; read-only).

The signal queries depend on how _your_ router records its own routing decisions and escalations. The Manager-Agent in this course writes its routing confidence and escalations into `details` on the rows it creates, so you query `details->>'category'` and `details->>'confidence'`. If your router records them differently, adjust the queries; the **judgment** (two-of-three, 14 days) is what transfers, not the exact SQL.

Confirm the live schema before relying on it: `paperclipai activity list --help` and a sample `SELECT ... FROM activity_log LIMIT 5`.

## How to record a gap (a real primitive, not a raw insert)

Do **not** `INSERT` into `activity_log`. The embedded Postgres is read-only by discipline, and Paperclip writes its own audit rows for real actions. To record a gap so it shows up in the audit trail and the board can see it, **open one tracking issue**:

- Create an issue titled `Capability gap: <category>`, assigned to no Worker (or to the board), with the signal evidence in the description: which two signals fired, the counts, the 14-day window, the example issue ids, and your recommended response from the four-way fork.
- Creating the issue makes Paperclip log a real `issue.created` row automatically (with the gap data inside the issue). That tracked issue _is_ the durable gap record. The crash course narrates this as a "gap_detected" event; realized against real Paperclip, it is a tracked issue, not a synthetic log row.
- Confirm the issue-create shape against the `paperclip` skill and your daemon (`paperclipai issue create --help`) before relying on field names.

One gap, one tracking issue. If the same category fires again while a gap issue is still open, comment on the existing issue rather than opening a duplicate.

## Improve this skill (it is a starter)

This file is the asset you own and grow, exactly as the crash course teaches. Concretely:

- **Tune the thresholds** (`3` issues, `0.6` confidence, `14` days) to your real traffic, and record why.
- **Add categories** your router cannot yet classify.
- **Generate the companion eval-pack runner with `skill-creator`** (its eval harness maps directly onto the course's scored rubric). Gap detection finds the need; the eval pack proves a candidate before the board sees it. Keep them as two skills, not one.
- **Pin versions.** This skill was written against Paperclip `2026.529.0`-era shapes (the `activity_log` schema below: cost is `cost_cents`, there is no `issue_id` column, and curriculum fields live in the `details` JSON). When you bump Paperclip, re-confirm the `activity_log` schema and the issue-create shape, and update the version note here.

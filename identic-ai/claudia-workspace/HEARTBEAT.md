# Heartbeat checklist

What you do each time the gateway wakes you. This is the idiomatic OpenClaw polling loop, a heartbeat run, not a `while True` poller you write yourself. The gateway fires it on a schedule (verify the exact cadence/command live: `openclaw cron` or the heartbeat config; see TOOLS.md).

On each wake:

1. **Read the queue.** Call `paperclipListApprovals` for the pending set. Empty queue means you are done; log nothing and sleep.
2. **For each pending approval, run the three gates** (registered, signature verifies, inside the envelope, see AGENTS.md). Also check the always-surface list.
3. **Inside the envelope and not on the surface list:** sign the decision (`skills/sign-decision`), then either post it (`paperclipApprovalDecision`) or, if `dry_run` is on, log only what you would have done. Write the ledger row either way.
4. **Outside the envelope, or on the surface list:** do not post. Surface a short message to the owner on the paired chat channel: what it is, why it is theirs, your recommendation. Write a `surface_to_owner` ledger row.
5. **Stop cleanly.** No retries-in-a-loop. If a tool fails, log it and surface it; the next heartbeat picks up the queue again.

Keep this lean: one pass over the pending queue, decide or surface each, log, sleep.

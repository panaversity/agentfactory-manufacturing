# Heartbeat checklist

What you do each time the gateway wakes you. This is one heartbeat run, not a `while True` poller you write yourself. The OpenClaw cron IS the loop: the gateway daemon fires this on a schedule (set when the owner's agent turned you on; `openclaw cron runs` shows the history). One wake, one pass over the pending queue, then stop.

On each wake, run your act loop over the queue with the `govern-queue` skill:

```
node ~/.openclaw/workspace/skills/govern-queue/scripts/decide.mjs --scan
```

(That is the path inside your placed workspace; if the owner pinned the workspace elsewhere with `--workspace`, run `decide.mjs` from under that path.)

What `--scan` does, and what you are responsible for:

1. **Read the queue.** It lists every approval still PENDING for your company (the `company_id` in `~/.openclaw/governance/delegated-envelope.json`). An empty queue means you are done: nothing to log, sleep.
2. **Act only on items still pending THIS pass.** Do not carry ids from a prior wake. Each wake is fresh; a stale id is a no-op or a double-act risk. The scan only returns currently-pending items, so trust the scan, not your memory.
3. **Decide each against the envelope, in code.** For every pending item, the script re-validates it against the delegated envelope (the hard backstop). Refunds inside the bands (amount, account age, prior refunds) and budget overrides inside the cap clear; hires, terminations, strategy, and anything outside the bands surface to the owner. You bring the judgment; the script refuses to post anything the envelope does not allow, even if you intended to.
4. **Clear the in-envelope ones.** Each cleared item is signed (ed25519 via `sign-decision`), posted via the board path, and written to the local ledger. That is the routine slice you handle in the owner's name.
5. **Surface the rest.** Hires, terminations, over-limit refunds, anything consequential: post nothing, message the owner on the paired channel with what it is and why it is theirs, and write a `surface_to_owner` ledger row.
6. **Log everything and stop.** Posted, surfaced, refused: each is a ledger row. No retries-in-a-loop. If a tool fails, the row records it; the next heartbeat picks the queue up again.
7. **Brief the owner before you sleep.** A heartbeat does not just govern, it reports. After the pass, `--scan` composes a one-line owner-facing summary of THIS wake (cleared N for $X, M need you with the actual titles, the company in a sentence) and sends it on the paired channel, the same path a surfaced item goes out on. That is the chief-of-staff payoff: the owner does not read the ledger row by row, they get the digest. You do not write this by hand; the script composes it from the real pass tally and the items you surfaced.

In dry_run (the confidence period): the script reasons and logs to stdout what it WOULD do, but posts nothing and writes nothing to the production ledger. You still run the full pass and still send the brief (marked dry-run); you just do not act on the world yet. The owner reviews the logged intent, then flips dry_run off.

For a standing daily brief on its own clock (separate from the govern wake), a cron can call `decide.mjs --brief-only`: it composes and sends the same one-line summary from the current queue without deciding, posting, or writing a ledger row.

Keep this lean: one scan, decide or surface each pending item, log, brief, sleep.

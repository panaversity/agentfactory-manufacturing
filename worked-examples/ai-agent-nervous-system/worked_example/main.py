"""Inngest function host (FastAPI): the floor's agent, made durable.

This is the durable-execution layer. The agent's logic does not change — it is
the same `support_agent` from agent.py. What changes is HOW it runs:

  * an event (`customer/email.received`) wakes a durable run instead of a hand call
  * the agent is BRACKETED by two audit steps: an `audit-ingress` step that logs
    EVERY inbound email (action `email_received`) before anything that can fail,
    and an `audit-reply` step that records the drafted reply (action `draft_created`)
    after the agent. The ingress row is written first, with a NULL customer_id, so
    an email from an unknown sender is still logged even though the run then fails
    at customer lookup — "every email received, before the agent acts" holds literally
  * the whole agent invocation (`Runner.run`) lives inside ONE `ctx.step.run`, so
    its result is memoized: on a retry, the completed agent step returns from memo
    and the model is NOT called again — only the step that actually failed re-runs
  * transient failures retry with backoff; the run persists its state across a crash

Run (ONE function host per dev server — stop any other host first):
    uv run uvicorn main:app --port 8000 --reload
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone

import fastapi
import inngest
import inngest.fast_api
from agents import Runner, RunState
from dotenv import load_dotenv

from agent import (
    ACTION_DRAFT_CREATED,
    ACTION_EMAIL_RECEIVED,
    ACTION_HEALTH_CHECK,
    ACTION_REFUND_BLOCKED,
    ACTION_REFUND_REQUESTED,
    SupportContext,
    _refund_args,
    get_customer,
    get_eligible_customers,
    seed_customers_if_empty,
    support_agent,
    write_audit,
)

# uvicorn does not load .env itself. Load it before constructing the client so
# INNGEST_DEV (dev mode) and OPENAI_API_KEY (the model call) are visible.
load_dotenv()

# Dev mode is opt-in and silent if forgotten: with INNGEST_DEV set the SDK talks
# to the local dev server; with neither this nor is_production=False it defaults
# to Cloud mode and nothing connects. Same app_id as the rest of the repo — which
# is exactly why only ONE function host may run against the dev server at a time.
inngest_client = inngest.Inngest(
    app_id="ai-agent-nervous-system",
    is_production=os.getenv("INNGEST_DEV") is None,
)


# Memoization probe (teaching aid, not production code). A step body runs ONLY
# when it is not memoized, so appending here records exactly which step bodies
# executed on each attempt. Read it at GET /debug/step-executions/{run_id}. We
# need our own observable proof because this dev-server MCP's get_run_status does
# not return per-step detail; this is how we show the agent step ran exactly once
# even when a later step is retried.
STEP_EXECUTIONS: dict[str, list[str]] = {}


class TransientPersistError(Exception):
    """Stand-in for a transient DB blip when writing the audit row."""


class AgentStepError(Exception):
    """A RETRIABLE failure injected into the agent step, to demonstrate that
    Inngest retries only the failed step while earlier steps stay memoized."""


# Break/fix switch for the durability demo. While True, the agent step
# (draft-reply) raises a retriable error on EVERY attempt — so the run retries,
# and the earlier audit-ingress step (which already succeeded) is served from
# memo and never re-runs. Flip to False ("fix the step") and the SAME run, on its
# next retry, replays from the top, gets ingress from memo (no new row), runs the
# now-fixed draft-reply, and completes — resuming from the broken step.
BREAK_AGENT_STEP = False


# Concurrency high-water probe (teaching aid, not production code). The dev
# server gates concurrency server-side, so it never dispatches more than the cap
# of `draft-reply` step bodies to this worker at once. We bracket that body with
# enter/exit and record the high-water mark — globally and per customer — so a
# 20-event burst can SHOW max concurrent == the cap (not all 20 at once) and that
# one customer never exceeds its per-customer key limit. asyncio is single
# threaded, so plain int bumps are safe here. Read/reset at /debug/concurrency.
_CC: dict = {"inflight": 0, "max": 0, "by_cust": {}, "max_by_cust": {}}


def _cc_enter(key: str) -> None:
    _CC["inflight"] += 1
    _CC["max"] = max(_CC["max"], _CC["inflight"])
    _CC["by_cust"][key] = _CC["by_cust"].get(key, 0) + 1
    _CC["max_by_cust"][key] = max(_CC["max_by_cust"].get(key, 0), _CC["by_cust"][key])


def _cc_exit(key: str) -> None:
    _CC["inflight"] -= 1
    _CC["by_cust"][key] = _CC["by_cust"].get(key, 1) - 1


# --- The durable function ----------------------------------------------------
#
# Triggered by `customer/email.received`. Event data:
#   {from_email, subject, body, fail_persist_times?}
# fail_persist_times is a TEACHING knob: it makes the audit-reply step raise a
# transient error on attempts < N, forcing Inngest to retry the run. Because the
# agent call sits in its own memoized step BEFORE audit-reply, the retry returns
# the draft from memo (no second OpenAI call) and only audit-reply re-executes —
# which is the whole point of putting the agent call inside step.run.
# --- Flow control: three controls, each protecting a DIFFERENT limit ----------
#
#   * Concurrency(limit=10)               GLOBAL cap. Bounds how many runs execute
#       a step AT ONCE, protecting the datastore: every step opens a Postgres
#       connection, so this caps in-flight connections (pool headroom for the cron
#       and inspection). It does NOT cap the per-minute rate — that's throttle.
#   * Concurrency(limit=2, key=from_email) PER-CUSTOMER cap (fairness). The key is
#       CEL on the EVENT, so the per-customer identity must be ON the event — here
#       `from_email`, which the event already carries. One noisy customer can hold
#       at most 2 of the 10 global slots, so their burst queues behind THEIR OWN
#       cap and can't starve the other customers. A ceiling (anti-monopoly), not a
#       reserved floor.
#   * Throttle(limit=30 / minute)         RATE cap. Protects OpenAI's ~30 req/min
#       account limit: bounds how many runs START per minute (throttle QUEUES the
#       excess; it does not drop it). 30 is OpenAI's actual cap — not a generic
#       100, which would be ~3x over. (One run ≈ one model call on the draft path.)
#       NOTE: concurrency bounds "how many at once"; throttle bounds "how many per
#       minute" — different limits, hence both.
#
# Enforcement on THIS dev server (per repo notes): concurrency IS enforced and is
# what the 20-event burst demonstrates; throttle is NOT enforced by the single-
# tenant dev queue (it needs a Cloud/branch deploy to observe), so it is
# configured and reasoned about here, not proven by the burst.
@inngest_client.create_function(
    fn_id="draft-support-reply",
    retries=3,  # retry transient failures (4 attempts total) with backoff
    trigger=inngest.TriggerEvent(event="customer/email.received"),
    concurrency=[
        inngest.Concurrency(limit=10),  # global: protect the Postgres pool
        inngest.Concurrency(limit=2, key="event.data.from_email"),  # per-customer fairness
    ],
    throttle=inngest.Throttle(limit=30, period=timedelta(minutes=1)),  # OpenAI 30/min
)
async def draft_support_reply(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    from_email = data.get("from_email")
    subject = data.get("subject", "(no subject)")
    body = data.get("body", "")

    def _record(step_name: str) -> None:
        STEP_EXECUTIONS.setdefault(ctx.run_id, []).append(
            f"{step_name}@attempt{ctx.attempt}"
        )

    # --- Step 1: INGRESS AUDIT — log EVERY inbound email, first -------------
    # This runs BEFORE the customer lookup (which can fail for an unknown
    # sender), so every received email is recorded before the agent acts. The
    # customer_id is NULL here on purpose: we have not resolved it yet, and an
    # unknown sender has none. Memoized, so a retry never writes a duplicate.
    def _audit_ingress() -> int:
        _record("audit-ingress")
        return write_audit(
            None,
            ACTION_EMAIL_RECEIVED,
            {"from_email": from_email, "subject": subject, "body": body},
        )

    ingress_audit_id = await ctx.step.run("audit-ingress", _audit_ingress)

    # --- Step 2: load the customer (a read; not itself an audited action) ---
    def _load_customer() -> dict:
        _record("load-customer")
        row = get_customer(from_email)
        if row is None:
            # An unknown sender will not become known by retrying — fail
            # permanently. The ingress row above is already committed, so the
            # email stays logged even though this run stops here.
            raise inngest.NonRetriableError(f"No customer on file for {from_email!r}")
        return {"id": int(row["id"]), "email": row["email"], "tier": row["tier"]}

    customer = await ctx.step.run("load-customer", _load_customer)

    # --- Step 3: the WHOLE agent call, inside ONE memoized step -------------
    # Runner.run lives entirely inside this step body, so the model is called once
    # and the result is memoized. On a retry of a LATER step, this returns from
    # memo — Inngest does not re-invoke the model (no double cost, no double work).
    async def _draft_reply() -> str:
        _record("draft-reply")
        # --- Injected agent-step break (durability demo) -------------------
        # Placed BEFORE the model call: the failure is unambiguously "the agent
        # step", and no OpenAI call is wasted on a doomed attempt. The 3s pause
        # widens the retry window so the break can be fixed mid-flight and the
        # SAME run recovered. Raised as a plain (retriable) error, so Inngest
        # retries per `retries=` — unlike NonRetriableError below.
        if BREAK_AGENT_STEP:
            await asyncio.sleep(3)
            raise AgentStepError(
                f"injected agent-step failure (attempt {ctx.attempt}); "
                "fix BREAK_AGENT_STEP to recover"
            )
        _cc_enter(from_email)  # concurrency high-water probe (teaching aid)
        try:
            prompt = (
                f"Customer: {from_email} (tier: {customer['tier']})\n"
                f"Subject: {subject}\n"
                f"Email body:\n{body}\n\n"
                "Write the reply."
            )
            sc = SupportContext(customer_id=customer["id"], customer_email=from_email)
            result = await Runner.run(support_agent, prompt, context=sc)
            if result.interruptions:
                # The agent wants to issue a refund. That needs the DURABLE approval
                # gate (a later layer), not this draft path — fail loud, not silent.
                raise inngest.NonRetriableError(
                    "agent requested a refund; route this email through the durable "
                    "refund-approval gate (a later layer), not the draft path"
                )
            return result.final_output
        finally:
            _cc_exit(from_email)

    draft = await ctx.step.run("draft-reply", _draft_reply)

    # --- Step 4: REPLY AUDIT — record the drafted reply, after the agent ----
    # The teaching knob lives here: raise a transient error on early attempts so
    # the run retries and we can watch the agent step (step 3) stay memoized.
    def _audit_reply() -> int:
        _record("audit-reply")
        fail_times = int(data.get("fail_persist_times") or 0)
        if ctx.attempt < fail_times:
            raise TransientPersistError(
                f"injected transient persist failure (attempt {ctx.attempt})"
            )
        return write_audit(
            customer["id"],
            ACTION_DRAFT_CREATED,
            {"subject": subject, "draft": draft},
        )

    reply_audit_id = await ctx.step.run("audit-reply", _audit_reply)

    return {
        "customer_id": customer["id"],
        "tier": customer["tier"],
        "draft": draft,
        "ingress_audit_id": ingress_audit_id,
        "reply_audit_id": reply_audit_id,
        "attempts_used": ctx.attempt + 1,
    }


# --- Cron fan-out: one health-check event per Pro/Enterprise customer --------
#
# Two triggers on ONE function:
#   * TriggerCron — the real daily schedule (09:00).
#   * TriggerEvent("cron/health_check.tick") — a manual kick, because the dev
#     server's invoke_function is unreliable here; sending the tick event is the
#     reliable way to invoke this by hand.
#
# Idempotency (the whole point of this layer): each child event carries a STABLE
# id, f"health-check-{day}-{customer_id}". `day` is derived from ctx.event.ts —
# the triggering event's timestamp, which is fixed across re-entries — NOT
# datetime.now() (a step body must be deterministic, and a fresh clock read would
# diverge on replay). If the cron is re-delivered the same day, every child id is
# identical, so Inngest's event dedupe (24h window) drops the duplicates and no
# child run double-fires. The send itself also lives in a step, so a cron retry
# returns the send from memo rather than fanning out twice.
@inngest_client.create_function(
    fn_id="health-check-cron",
    retries=3,
    trigger=[
        inngest.TriggerCron(cron="0 9 * * *"),
        inngest.TriggerEvent(event="cron/health_check.tick"),
    ],
)
async def health_check_cron(ctx: inngest.Context) -> dict:
    # Stable date bucket. Must be deterministic across re-entries (a step body
    # and the child ids must not vary on replay), so we never call datetime.now().
    # Prefer an explicit `day` on the event (the manual tick carries one); else
    # derive it from the triggering event's timestamp (ctx.event.ts, epoch ms),
    # which a REAL cron run sets. A manually-sent event has ts == 0, which is why
    # an unguarded ts-only bucket would collapse to 1970-01-01 — hence the data
    # override is the reliable hand-invoke path.
    data = ctx.event.data or {}
    ts_ms = ctx.event.ts or 0
    day = data.get("day") or (
        datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        if ts_ms
        else "undated"
    )

    def _load_eligible() -> list[dict]:
        return [
            {"id": int(c["id"]), "email": c["email"], "tier": c["tier"]}
            for c in get_eligible_customers()
        ]

    eligible = await ctx.step.run("load-eligible", _load_eligible)

    # One child event per eligible customer, each idempotency-keyed.
    events = [
        inngest.Event(
            name="customer/health_check.requested",
            id=f"health-check-{day}-{c['id']}",
            data={
                "customer_id": c["id"],
                "email": c["email"],
                "tier": c["tier"],
                "day": day,
            },
        )
        for c in eligible
    ]
    await ctx.step.send_event("fan-out-health-checks", events)

    return {
        "day": day,
        "eligible_count": len(eligible),
        "child_event_ids": [e.id for e in events],
    }


# --- The child run: one durable run per customer, writes one audit row --------
#
# Each fanned-out event triggers its OWN run of this function. It stamps its
# ctx.run_id into the audit detail so the rows prove distinct runs (one per
# eligible customer). The single write lives in a step, so a retry is memoized
# and never writes a second row.
@inngest_client.create_function(
    fn_id="health-check-run",
    retries=3,
    trigger=inngest.TriggerEvent(event="customer/health_check.requested"),
)
async def health_check_run(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    customer_id = data.get("customer_id")
    tier = data.get("tier")
    day = data.get("day")

    def _audit_health_check() -> int:
        return write_audit(
            customer_id,
            ACTION_HEALTH_CHECK,
            {
                "email": data.get("email"),
                "tier": tier,
                "day": day,
                "run_id": ctx.run_id,
            },
        )

    health_audit_id = await ctx.step.run("audit-health-check", _audit_health_check)

    return {
        "customer_id": customer_id,
        "tier": tier,
        "day": day,
        "run_id": ctx.run_id,
        "health_audit_id": health_audit_id,
    }


# --- Durable HITL: the ephemeral refund approval, made to survive ------------
#
# The floor (agent.py) already pauses for refund approval: the SDK raises an
# approval interruption on issue_refund and `handle_email` decides in-process.
# That pause is EPHEMERAL — a crash, a deploy, or a reviewer who takes four hours
# loses it. This function makes the SAME pause durable. The single internal the
# nervous system reaches inside is exactly this suspension.
#
# Shape (the one verified shape; deviating fails silently):
#   1. run the agent INSIDE step.run and inspect result.interruptions
#   2. on an interruption, persist result.to_state().to_string() as that step's
#      OUTPUT (so the pending refund is durable state, not in-process memory)
#   3. suspend with ctx.step.wait_for_event(timeout=4h), matched to THIS run
#   4. on the decision event, await RunState.from_string(agent, state_str),
#      approve/reject every interruption, then resume Runner.run(agent, state)
#      with NO context= (re-passing context wipes the decision and loops forever)
#
# Triggered by its OWN event (customer/refund_email.received) so it does not
# collide with draft-support-reply, whose draft path deliberately routes refunds
# here. In production one ingress webhook would classify-then-route; in dev we
# send this event directly to "drive a refund".
#
# Exactly-once: the issue_refund tool writes the SINGLE refund_issued row, and it
# runs inside the memoized resume-agent step — so a replay or a duplicate decision
# returns from memo and the refund never fires twice. The idempotency_key on the
# refund row is the real-world-boundary complement (what a payment processor would
# dedupe on across runs). On reject the tool never runs; we write refund_blocked.
@inngest_client.create_function(
    fn_id="refund-approval-gate",
    retries=3,
    trigger=inngest.TriggerEvent(event="customer/refund_email.received"),
)
async def refund_approval_gate(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    from_email = data.get("from_email")
    subject = data.get("subject", "(no subject)")
    body = data.get("body", "")
    request_id = data.get("request_id")  # optional caller-supplied idempotency seed

    def _record(step_name: str) -> None:
        STEP_EXECUTIONS.setdefault(ctx.run_id, []).append(
            f"{step_name}@attempt{ctx.attempt}"
        )

    # --- Step 1: INGRESS AUDIT — log the inbound email, first --------------
    def _audit_ingress() -> int:
        _record("audit-ingress")
        return write_audit(
            None,
            ACTION_EMAIL_RECEIVED,
            {"from_email": from_email, "subject": subject, "body": body},
        )

    await ctx.step.run("audit-ingress", _audit_ingress)

    # --- Step 2: load the customer ----------------------------------------
    def _load_customer() -> dict:
        _record("load-customer")
        row = get_customer(from_email)
        if row is None:
            raise inngest.NonRetriableError(f"No customer on file for {from_email!r}")
        return {"id": int(row["id"]), "email": row["email"], "tier": row["tier"]}

    customer = await ctx.step.run("load-customer", _load_customer)

    # Deterministic idempotency key for the refund's real-world effect. Built from
    # the customer id + a stable seed (request_id, else ctx.run_id — the run id is
    # stable across re-entries, so this is NOT a "fresh id inside a step").
    idem_key = f"refund:{customer['id']}:{request_id or ctx.run_id}"

    # --- Step 3: run the agent; persist the serialized state if it pauses ---
    # The agent runs ENTIRELY inside this step, so the model is called once and
    # memoized. If it asked for a refund we return the SERIALIZED RunState as the
    # step output — that is the durable pending-approval state.
    async def _run_agent_until_pause() -> dict:
        _record("run-agent")
        prompt = (
            f"Customer: {from_email} (tier: {customer['tier']})\n"
            f"Subject: {subject}\n"
            f"Email body:\n{body}\n\n"
            "Write the reply."
        )
        sc = SupportContext(
            customer_id=customer["id"],
            customer_email=from_email,
            idempotency_key=idem_key,
        )
        result = await Runner.run(support_agent, prompt, context=sc)
        if not result.interruptions:
            return {"kind": "reply", "draft": result.final_output}
        state_str = result.to_state().to_string()
        pending = [
            {
                "amount": _refund_args(i).get("amount"),
                "reason": _refund_args(i).get("reason"),
            }
            for i in result.interruptions
        ]
        return {"kind": "needs_approval", "state": state_str, "pending": pending}

    outcome = await ctx.step.run("run-agent", _run_agent_until_pause)

    # --- Normal-reply path: no refund requested, just record the draft -----
    if outcome["kind"] == "reply":
        draft = outcome["draft"]

        def _audit_reply() -> int:
            _record("audit-reply")
            return write_audit(
                customer["id"],
                ACTION_DRAFT_CREATED,
                {"subject": subject, "draft": draft},
            )

        await ctx.step.run("audit-reply", _audit_reply)
        return {"status": "replied", "customer_id": customer["id"], "draft": draft}

    # --- Refund path: record the request, notify, then SUSPEND -------------
    pending = outcome["pending"]
    state_str = outcome["state"]

    def _audit_refund_requested() -> int:
        _record("audit-refund-requested")
        first = pending[0] if pending else {}
        return write_audit(
            customer["id"],
            ACTION_REFUND_REQUESTED,
            {
                "customer_email": from_email,
                "amount": first.get("amount"),
                "reason": first.get("reason"),
                "idempotency_key": idem_key,
                "request_id": request_id,
                # The reviewer resumes by sending customer/refund.decided with this
                # run_id; storing it makes a suspended run correlatable from the DB.
                "run_id": ctx.run_id,
            },
        )

    await ctx.step.run("audit-refund-requested", _audit_refund_requested)

    def _notify_reviewer() -> bool:
        # Dev: a log line stands in for Slack/webhook. The reviewer replies by
        # sending customer/refund.decided with this run_id and approved=true|false.
        _record("notify-reviewer")
        ctx.logger.info(
            f"[REVIEW NEEDED] refund for {from_email} (run {ctx.run_id}): "
            f"{pending} — send customer/refund.decided "
            f"{{run_id: {ctx.run_id!r}, approved: true|false}} to decide."
        )
        return True

    await ctx.step.run("notify-reviewer", _notify_reviewer)

    # --- SUSPEND: durable wait for the decision (4-hour window) ------------
    # if_exp matches the decision to THIS run, so one suspended run can only be
    # resumed by ITS OWN decision event (never another customer's). While waiting
    # the run is status "waiting" in the dashboard — survives a crash or a deploy.
    decision_event = await ctx.step.wait_for_event(
        "await-refund-decision",
        event="customer/refund.decided",
        timeout=timedelta(hours=4),
        if_exp=f"async.data.run_id == '{ctx.run_id}'",
    )

    # --- Timeout: no decision within the window -> default to blocked ------
    if decision_event is None:
        def _audit_timeout() -> int:
            _record("audit-timeout")
            return write_audit(
                customer["id"],
                ACTION_REFUND_BLOCKED,
                {
                    "customer_email": from_email,
                    "decision": "timed_out",
                    "idempotency_key": idem_key,
                },
            )

        await ctx.step.run("audit-timeout", _audit_timeout)
        return {"status": "blocked", "reason": "timeout", "customer_id": customer["id"]}

    # --- Resume the agent with the reviewer's decision --------------------
    # The agent run lives INSIDE this step. On approve, issue_refund fires here and
    # writes the one refund_issued row; memoization makes that exactly-once.
    approved = bool(decision_event.data.get("approved"))

    async def _resume_with_decision() -> dict:
        _record("resume-agent")
        # CRITICAL: the SDK does NOT serialize a custom run context into
        # RunState.to_string — it warns ("context ... is not serializable; storing
        # empty context") and drops it. Without re-supplying it, issue_refund runs
        # on resume with an EMPTY context (no customer_id / idempotency_key) and
        # silently fails to record the refund (verified: zero refund_issued rows).
        # Rebuild the context from the deterministic, event-derived facts and
        # re-inject it via context_override so the approved tool fires correctly.
        sc = SupportContext(
            customer_id=customer["id"],
            customer_email=from_email,
            idempotency_key=idem_key,
        )
        state = await RunState.from_string(
            support_agent, state_str, context_override=sc
        )
        for item in state.get_interruptions():
            state.approve(item) if approved else state.reject(item)
        # Resume WITHOUT context= on Runner.run (that wipes the decision and loops
        # forever); the context is already on the state via context_override above.
        result = await Runner.run(support_agent, state)
        while result.interruptions:  # one resume can leave approvals pending
            st = result.to_state()  # in-memory, so it keeps the context
            for item in st.get_interruptions():
                st.approve(item) if approved else st.reject(item)
            result = await Runner.run(support_agent, st)
        return {"final_output": result.final_output}

    resume = await ctx.step.run("resume-agent", _resume_with_decision)

    # On REJECT the tool never ran, so no refund_issued row exists — record the
    # block here. On APPROVE the refund_issued row was already written by the tool
    # inside resume-agent, so we do NOT write a second refund row.
    if not approved:
        def _audit_blocked() -> int:
            _record("audit-blocked")
            return write_audit(
                customer["id"],
                ACTION_REFUND_BLOCKED,
                {
                    "customer_email": from_email,
                    "decision": "rejected",
                    "idempotency_key": idem_key,
                },
            )

        await ctx.step.run("audit-blocked", _audit_blocked)

    # --- Record the customer-facing reply (every meaningful action audits) ---
    # The normal draft path audits draft_created; the refund paths must too, so the
    # reply that actually goes to the customer is in the trail alongside the
    # refund_issued / refund_blocked decision. Tagging it with the decision lets a
    # later query catch the contradiction the floor's instructions now prevent (a
    # reply promising a refund that was in fact blocked).
    final_reply = resume["final_output"]

    def _audit_reply() -> int:
        _record("audit-reply")
        return write_audit(
            customer["id"],
            ACTION_DRAFT_CREATED,
            {
                "subject": subject,
                "draft": final_reply,
                "refund_decision": "approved" if approved else "rejected",
                "idempotency_key": idem_key,
            },
        )

    await ctx.step.run("audit-reply", _audit_reply)

    return {
        "status": "refunded" if approved else "blocked",
        "approved": approved,
        "customer_id": customer["id"],
        "idempotency_key": idem_key,
        "final_output": final_reply,
    }


app = fastapi.FastAPI()


@app.get("/debug/step-executions/{run_id}")
def step_executions(run_id: str) -> dict:
    """Which step bodies actually executed for a run (memoization probe).

    counts['draft-reply'] == 1 across a retried run is the proof that the agent
    step was memoized: it ran once, and the retry reused its result.
    """
    executed = STEP_EXECUTIONS.get(run_id, [])
    counts: dict[str, int] = {}
    for entry in executed:
        name = entry.split("@", 1)[0]
        counts[name] = counts.get(name, 0) + 1
    return {"run_id": run_id, "executed": executed, "counts": counts}


@app.get("/debug/concurrency")
def concurrency_probe() -> dict:
    """Concurrency high-water marks since the last reset.

    max_global == the global cap (and < the burst size) is the proof that runs
    queued under the cap. max_per_customer[c] <= the per-customer key limit is the
    proof one customer can't grab more than its share.
    """
    return {
        "max_global": _CC["max"],
        "max_per_customer": _CC["max_by_cust"],
        "current_inflight": _CC["inflight"],
    }


@app.get("/debug/concurrency/reset")
def concurrency_reset() -> dict:
    """Zero the high-water marks. Call this BEFORE a burst (nothing in flight)."""
    _CC.update(inflight=0, max=0, by_cust={}, max_by_cust={})
    return {"reset": True}


@app.get("/debug/step-executions")
def step_executions_all() -> dict:
    """All recorded runs (memoization probe), newest insertion last."""
    out = {}
    for run_id, executed in STEP_EXECUTIONS.items():
        counts: dict[str, int] = {}
        for entry in executed:
            name = entry.split("@", 1)[0]
            counts[name] = counts.get(name, 0) + 1
        out[run_id] = {"executed": executed, "counts": counts}
    return {"runs": out, "run_count": len(out)}


# Seed the sample customers once at host startup if the table is empty (no-op
# here — the table already has rows). Safe and idempotent.
seed_customers_if_empty()

inngest.fast_api.serve(
    app,
    inngest_client,
    [draft_support_reply, health_check_cron, health_check_run, refund_approval_gate],
)

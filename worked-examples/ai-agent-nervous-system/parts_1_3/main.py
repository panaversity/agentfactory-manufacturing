"""Inngest function host (FastAPI) for the AI Agent Nervous System base.

Quick Win: one tiny durable function, `greet-customer`, that proves the
durable-execution shape — two memoized `step.run` calls bracketing a
`step.sleep` that survives a process restart.

Run:  uv run uvicorn main:app --port 8000 --reload
"""

import datetime
import json
import os

import fastapi
import httpx
import inngest
import inngest.fast_api
import openai
import psycopg
from agents import (
    Agent,
    InputGuardrailTripwireTriggered,
    MaxTurnsExceeded,
    ModelBehaviorError,
    ModelRefusalError,
    OutputGuardrailTripwireTriggered,
    Runner,
)
from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg.types.json import Json

# uvicorn does not load .env itself; do it before constructing the client so
# INNGEST_DEV (and OPENAI_API_KEY later) are visible to the SDK.
load_dotenv()

# Dev mode is opt-in and silent if forgotten: with INNGEST_DEV set, the SDK
# talks to the local dev server instead of defaulting to Cloud mode.
inngest_client = inngest.Inngest(
    app_id="ai-agent-nervous-system",
    is_production=os.getenv("INNGEST_DEV") is None,
)

# Minimal hello-world agent (OpenAI Agents SDK): it just writes the greeting.
# Reads OPENAI_API_KEY from the env that load_dotenv() populated above.
greeter_agent = Agent(
    name="Greeter",
    instructions=(
        "Write a single short, friendly one-line greeting to the person named "
        "in the prompt. Output only the greeting, nothing else."
    ),
    model="gpt-4o-mini",
)

# Customer-support drafting agent. This is the floor's agent logic; the Inngest
# nervous system below does not change what it does, only how the world reaches
# it (an event) and what survives a crash (each step memoized).
support_agent = Agent(
    name="SupportDrafter",
    instructions=(
        "You are a customer-support agent. Given an incoming customer email, the "
        "customer's tier, and their recent account history, write a concise, warm "
        "draft reply for a human reviewer to approve before it is sent. Acknowledge "
        "the issue, reference relevant history when useful, and propose a clear next "
        "step. Output only the reply body, no subject line and no preamble."
    ),
    model="gpt-4o-mini",
)

# Refund-investigation agent. After a human picks up a failed refund, this drafts
# the first-pass investigation summary the on-call engineer reads. Same floor
# pattern as the others: its logic is unchanged by Inngest; the nervous system
# only decides *when* it runs (after a durable human click, never before).
investigation_agent = Agent(
    name="RefundInvestigator",
    instructions=(
        "You are a payments on-call engineer. Given the details of a FAILED refund "
        "and who picked it up, write a concise investigation summary for the on-call "
        "log: state the likely cause from the failure reason, the customer impact, and "
        "2-3 concrete next steps to resolve it. Be specific and brief. Output only the "
        "summary, no preamble."
    ),
    model="gpt-4o-mini",
)


@inngest_client.create_function(
    fn_id="greet-customer",
    trigger=inngest.TriggerEvent(event="demo/greet"),
)
async def greet_customer(ctx: inngest.Context) -> dict:
    """Compose a greeting, wait 15s durably, then compose a farewell.

    Each step.run is memoized: on a retry or replay, a completed step
    returns from memo instead of re-running. The sleep is server-side, so
    the run survives a host crash/restart during the wait.
    """
    name = ctx.event.data.get("name", "there")

    # The agent call (Runner.run) lives INSIDE step.run, so it is memoized:
    # on a retry/replay the greeting returns from memo, the model is not re-called.
    async def _compose_greeting() -> str:
        result = await Runner.run(greeter_agent, f"Greet a customer named {name}.")
        return result.final_output

    greeting = await ctx.step.run("compose-greeting", _compose_greeting)

    await ctx.step.sleep("wait-15s", datetime.timedelta(seconds=15))

    farewell = await ctx.step.run("compose-farewell", lambda: f"Goodbye, {name}!")

    return {"greeting": greeting, "farewell": farewell}


# Memoization probe (teaching aid, not production code). A step body only runs
# when it is NOT memoized, so appending here records exactly which step bodies
# actually executed on each attempt. Keyed by run_id. Read it via
# GET /debug/step-executions/{run_id}. This exists because this dev-server MCP's
# get_run_status returns steps:null, so we need our own observable proof that
# steps 1-3 do not re-execute on a retry.
STEP_EXECUTIONS: dict[str, list[str]] = {}


# --- Retry/failure classification (Concept 6 extension) --------------------
#
# Inngest's retry count is configured PER FUNCTION, not per step ("Individual
# steps inherit the function's retry policy" — per the retries reference). So to
# give three steps three different retry budgets we set the function ceiling to
# the largest any step needs (Slack's 10) and let the cheaper steps self-cap
# *inside their own body* using ctx.attempt + NonRetriableError. The whole
# transient-vs-permanent decision therefore lives inside each step body: a step
# that re-raises is retried by Inngest (up to the ceiling); a step that raises
# NonRetriableError stops immediately; a step that returns a value has succeeded.
# (A try/except *around* ctx.step.run only ever sees inngest.StepError, and only
# after retries are exhausted — too late to classify the original error.)
#
# Why these classes: Runner.run propagates the underlying `openai` exceptions
# unchanged, so we classify on them directly. A content-policy refusal reaches us
# two ways and BOTH are permanent: the Agents SDK raises agents.ModelRefusalError
# when the model itself refuses, and the API returns openai.BadRequestError
# (HTTP 400, code 'content_filter') for a blocked request. (Installed here:
# openai-agents 0.17.4, which DOES export ModelRefusalError — AGENTS.md pins
# 0.17.3; the installed package wins, per AGENTS.md's own "the docs win" rule.)

# Transient: the SAME request may succeed on a later attempt → worth retrying.
TRANSIENT_MODEL_ERRORS = (
    openai.RateLimitError,  # 429 — provider rate limit
    openai.APITimeoutError,  # request timed out (subclass of APIConnectionError)
    openai.APIConnectionError,  # network blip reaching OpenAI
    openai.InternalServerError,  # 5xx on OpenAI's side
)

# Permanent: the SAME request will fail identically → retrying only burns
# attempts (and money). Content-policy refusal lives here, per the spec.
PERMANENT_MODEL_ERRORS = (
    ModelRefusalError,  # the model itself refused (content policy) — SDK-level
    openai.BadRequestError,  # 400 incl. content_filter / invalid prompt
    openai.AuthenticationError,  # 401 — bad/missing key
    openai.PermissionDeniedError,  # 403
    InputGuardrailTripwireTriggered,  # our own guardrails fired on input
    OutputGuardrailTripwireTriggered,  # ...or on output
    ModelBehaviorError,  # malformed tool call / bad schema — not fixed by retry
    MaxTurnsExceeded,  # ran out of turns — same input loops again
)

# Per-step retry budgets (Inngest "retries" = retries AFTER the initial attempt,
# so attempts = retries + 1). The function ceiling below is SLACK_MAX_RETRIES.
MODEL_MAX_RETRIES = 3  # draft step: 3 retries (4 attempts) on transient errors
DB_MAX_RETRIES = 1  # persist step: 1 retry (2 attempts), then log + continue
SLACK_MAX_RETRIES = 10  # notify step: 10 retries (11 attempts) — never drop it

# A stand-in for a flaky Slack delivery (in prod this would be httpx/slack_sdk
# raising on a 5xx or timeout). Treated as transient: we retry, we don't drop.
class SlackNotificationError(Exception):
    """Transient failure delivering the reviewer notification."""


# Dummy endpoint used only to construct realistic injected openai exceptions.
_OPENAI_URL = "https://api.openai.com/v1/responses"


# --- Customer-support email worker (event → durable run) -------------------
#
# The AI Worker: a customer email wakes a durable run that drafts a reply for a
# human reviewer. The agent's logic is unchanged from the floor; what changed is
# that each meaningful piece of work now lives in its own named step.run, so on a
# retry only the failed step re-executes and the completed ones return from memo.
#
# Five steps, each memoized independently, each with its OWN failure policy:
#   1. load-customer    read the customer row              (DB read; unknown = permanent)
#   2. load-thread      read recent audit_log = the thread (DB read)
#   3. draft-reply      Runner.run(...) the agent          (3 retries on transient,
#                                                            NO retry on content-policy)
#   4. persist-draft    write the 'draft_created' audit row (1 retry, then log + continue)
#   5. notify-reviewer  ping the on-call reviewer           (10 retries — don't lose it)
#
# Event data (a Postmark webhook in prod; send_event in dev):
#   {email_id, from_email, subject, body, customer_id, tier}
#   customer_id + tier are enrichment fields the webhook/CRM stamps (path B); the
#   per-customer concurrency key uses customer_id and the priority expression uses tier.
# Failure-injection knobs (teaching aids — drive the classified paths without a
# real outage; all keyed on ctx.attempt so they compose with Inngest's retries):
#   draft_fail_transient: N  -> draft raises APITimeoutError on attempts < N
#   draft_fail_policy: true   -> draft raises a content-policy BadRequestError once
#   draft_stub: true          -> skip the real OpenAI call (no key / fast tests)
#   persist_fail_times: N     -> persist raises OperationalError on attempts < N
#   slack_fail_times: N       -> notify raises SlackNotificationError on attempts < N
#
# retries=SLACK_MAX_RETRIES is the function-wide CEILING (the most any one step
# needs). The draft and persist steps deliberately cap themselves *below* it.
# --- Flow control reasoning (the knobs; realized PER-LANE in the tier lanes below) ---
#
# 1 run is NOT 1 OpenAI request: Runner.run drafts, may reason about a tool, may
# call issue_refund, then composes a reply — ~N model calls/run. We assume N≈3
# until measured from the dev-server dashboard; that N is the only number below
# that's a guess, and it only feeds the throttle. Re-derive after the first real
# runs.
#
#   throttle (limit=10/min)  -> protects the OpenAI 30 req/min HARD CAP.
#       30 req/min ÷ N(=3) ≈ 10 runs/min. Throttle QUEUES the excess (vs
#       RateLimit, which DROPS it) — for customer email, late is fine, lost is
#       not. NOT the brief's generic limit=100 example: at N≈3 that is 300
#       req/min, ~10x over the cap. The exercise's 30 req/min constraint wins.
#       Cost: latency only appears inside 9am/2pm bursts (avg load is ~0.7/min);
#       a tight 150-email/5-min peak drains in ~10 min — that wait is the cost of
#       the OpenAI cap itself, not of this config.
#
#   concurrency limit=10 (global) -> protects the Postgres pool (20 conns, 1/run).
#       10 leaves ~10 conns of headroom for the cron, migrations, inspection. It
#       only BITES if runs get slow (>~60s): at 10 starts/min × >1min/run, in-
#       flight tries to exceed 10 and this caps it. A saturated global cap is a
#       "why did runs get slow" signal, not a "raise the limit" one.
#
#   concurrency limit=3 (per customer, key=customer_id) -> fairness / anti-starvation
#       (req #4). A single customer can occupy AT MOST 3 of the global slots; the
#       rest of their burst queues behind THEIR OWN cap, leaving slots for everyone
#       else. This is a CEILING (anti-monopoly), not a reserved floor. Keys are CEL
#       on the EVENT at schedule time, so the event must carry customer_id (the
#       webhook/CRM stamps it; earlier we keyed on from_email because the bare event
#       lacked an id — path B enriches the event so we can use the real id).
#
#   priority (req #1) -> tier ordering of the backlog. The `run` factor is in
#       SECONDS (±600 cap), NOT a rank: a run jumps ahead of jobs enqueued up to that
#       many seconds earlier. Enterprise 300, Pro 60, Free 0. Requires event.data.tier.
#       NOTE (req #2/#3): priority CANNOT guarantee "Enterprise ≤5s" or "Free not
#       starved >60s". It REORDERS the queue; it does not RESERVE capacity — an
#       Enterprise run still waits for a slot, just gets the next one. Under a full
#       queue that wait is nonzero and bounded only by run duration, which is exactly
#       why a real latency SLA needs a dedicated concurrency pool per tier (a separate
#       function/lane), not this expression.
# Shared worker body. The agent logic is unchanged; the THREE TIER LANES defined
# after this function each wrap it with their OWN reserved concurrency pool, so a
# flood in one tier cannot consume another tier's capacity. Reserved pools are the
# honest way to meet a latency SLA: priority only REORDERS a shared queue (Enterprise
# still waited up to ~20s in local testing), whereas a dedicated pool means Enterprise
# never competes with Free for a slot at all.
async def _handle_support_email(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    email_id = data.get("email_id")
    from_email = data.get("from_email")
    subject = data.get("subject", "(no subject)")
    body = data.get("body", "")

    def _record(step_name: str) -> None:
        # Runs only when a step body actually executes (memoized bodies skip it).
        STEP_EXECUTIONS.setdefault(ctx.run_id, []).append(
            f"{step_name}@attempt{ctx.attempt}"
        )

    def _int(key: str) -> int:
        # Event data is JSON: a knob may arrive as int, str, or be absent/None.
        return int(data.get(key) or 0)

    # --- Step 1: load the customer record -----------------------------------
    def _load_customer() -> dict:
        _record("load-customer")
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT id, email, tier FROM customers WHERE email = %(email)s",
                {"email": from_email},
            ).fetchone()
        if row is None:
            # Unknown sender will not become known by retrying — permanent.
            raise inngest.NonRetriableError(f"No customer for email {from_email!r}")
        return {"id": int(row["id"]), "email": row["email"], "tier": row["tier"]}

    customer = await ctx.step.run("load-customer", _load_customer)

    # --- Step 2: load the related conversation thread -----------------------
    # On the minimal floor the "thread" is the customer's recorded audit history.
    def _load_thread() -> list[dict]:
        _record("load-thread")
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            rows = conn.execute(
                """
                SELECT action, detail, created_at
                FROM audit_log
                WHERE customer_id = %(cid)s
                ORDER BY created_at DESC
                LIMIT 10
                """,
                {"cid": customer["id"]},
            ).fetchall()
        return [
            {
                "action": r["action"],
                "detail": r["detail"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]

    thread = await ctx.step.run("load-thread", _load_thread)

    # --- Step 3: run the agent — 3 retries on transient, none on content-policy ---
    # Runner.run lives INSIDE step.run, so the model is called once and memoized.
    # The try/except is INSIDE the body so we can classify the ORIGINAL exception
    # and decide, per attempt, whether Inngest should retry it.
    async def _draft_reply() -> dict:
        _record("draft-reply")
        try:
            # Injection: a content-policy refusal (permanent) ...
            if data.get("draft_fail_policy"):
                raise openai.BadRequestError(
                    "Injected content-policy refusal (content_filter)",
                    response=httpx.Response(
                        400, request=httpx.Request("POST", _OPENAI_URL)
                    ),
                    body={"error": {"code": "content_filter"}},
                )
            # ... or a transient timeout on the first N attempts.
            if ctx.attempt < _int("draft_fail_transient"):
                raise openai.APITimeoutError(
                    request=httpx.Request("POST", _OPENAI_URL)
                )

            history = "\n".join(
                f"- [{e['created_at']}] {e['action']}: {json.dumps(e['detail'])}"
                for e in thread
            ) or "(no prior history)"
            prompt = (
                f"Customer: {customer['email']} (tier: {customer['tier']})\n"
                f"Incoming email subject: {subject}\n"
                f"Incoming email body:\n{body}\n\n"
                f"Recent account history (most recent first):\n{history}\n\n"
                "Write the draft reply."
            )
            if data.get("draft_stub"):
                text = f"[stubbed draft for {customer['email']} re: {subject}]"
            else:
                result = await Runner.run(support_agent, prompt)
                text = result.final_output
            return {"draft": text, "attempts": ctx.attempt + 1}
        except PERMANENT_MODEL_ERRORS as e:
            # Content-policy & friends: identical retry would fail identically.
            ctx.logger.error(
                "draft-reply permanent failure, NOT retrying: %s: %s",
                type(e).__name__,
                e,
            )
            raise inngest.NonRetriableError(
                f"model call failed permanently ({type(e).__name__}): {e}"
            ) from e
        except TRANSIENT_MODEL_ERRORS as e:
            if ctx.attempt < MODEL_MAX_RETRIES:
                ctx.logger.warning(
                    "draft-reply transient failure (attempt %d/%d), retrying: %s",
                    ctx.attempt + 1,
                    MODEL_MAX_RETRIES + 1,
                    e,
                )
                raise  # re-raise → Inngest retries this step
            ctx.logger.error(
                "draft-reply still failing after %d retries, giving up: %s",
                MODEL_MAX_RETRIES,
                e,
            )
            raise inngest.NonRetriableError(
                f"model call still transient-failing after {MODEL_MAX_RETRIES} "
                f"retries: {e}"
            ) from e
        except Exception as e:
            # Unknown error: we only retry what we KNOW is transient. Anything
            # unclassified fails fast and loud (NonRetriable) instead of silently
            # consuming the function-wide retry ceiling meant for Slack.
            ctx.logger.error(
                "draft-reply unexpected error, NOT retrying: %s: %s",
                type(e).__name__,
                e,
            )
            raise inngest.NonRetriableError(
                f"draft-reply unexpected error ({type(e).__name__}): {e}"
            ) from e

    draft_info = await ctx.step.run("draft-reply", _draft_reply)
    draft = draft_info["draft"]

    # --- Step 4: persist the draft — 1 retry, then log + continue (degraded) ---
    # Per decision: a transient DB blip must not fail the whole run. We retry
    # once; if it still fails we log loudly and return a degraded result instead
    # of raising, so the run proceeds to notify + return. NOTE: this trades away
    # the "every action writes its audit row" invariant for availability — the
    # loss is surfaced (ERROR log + degraded:true in the output), never silent.
    def _persist_draft() -> dict:
        _record("persist-draft")
        try:
            if ctx.attempt < _int("persist_fail_times"):
                raise psycopg.OperationalError("Injected transient DB blip")
            with psycopg.connect(
                os.environ["DATABASE_URL"], row_factory=dict_row
            ) as conn:
                row = conn.execute(
                    """
                    INSERT INTO audit_log (customer_id, action, detail)
                    VALUES (%(cid)s, 'draft_created', %(detail)s)
                    RETURNING id
                    """,
                    {
                        "cid": customer["id"],
                        "detail": Json(
                            {"email_id": email_id, "subject": subject, "draft": draft}
                        ),
                    },
                ).fetchone()
            return {
                "audit_id": int(row["id"]),
                "persisted": True,
                "degraded": False,
                "attempts": ctx.attempt + 1,
            }
        except psycopg.Error as e:
            if ctx.attempt < DB_MAX_RETRIES:
                ctx.logger.warning(
                    "persist-draft DB error (attempt %d/%d), retrying: %s",
                    ctx.attempt + 1,
                    DB_MAX_RETRIES + 1,
                    e,
                )
                raise  # re-raise → Inngest retries this step once
            ctx.logger.error(
                "persist-draft failed after %d retry; CONTINUING without the "
                "draft_created audit row (degraded): %s",
                DB_MAX_RETRIES,
                e,
            )
            return {
                "audit_id": None,
                "persisted": False,
                "degraded": True,
                "error": str(e),
                "attempts": ctx.attempt + 1,
            }

    persisted = await ctx.step.run("persist-draft", _persist_draft)

    # --- Step 5: notify the on-call reviewer — 10 retries (don't lose it) ----
    # In prod this is a Slack/webhook call; in dev we simulate it (log + marker).
    def _notify_reviewer() -> dict:
        _record("notify-reviewer")
        audit_ref = (
            f"audit #{persisted['audit_id']}"
            if persisted["persisted"]
            else "NO audit row (draft persist degraded)"
        )
        message = (
            f"Draft reply ready for {customer['email']} "
            f"({audit_ref}, re: {subject!r}) — awaiting review."
        )
        try:
            if ctx.attempt < _int("slack_fail_times"):
                raise SlackNotificationError("Injected transient Slack failure")
            ctx.logger.info("reviewer-notification: %s", message)
            return {
                "notified": True,
                "channel": "on-call (simulated)",
                "message": message,
                "attempts": ctx.attempt + 1,
            }
        except SlackNotificationError as e:
            if ctx.attempt < SLACK_MAX_RETRIES:
                ctx.logger.warning(
                    "notify-reviewer Slack failure (attempt %d/%d), retrying: %s",
                    ctx.attempt + 1,
                    SLACK_MAX_RETRIES + 1,
                    e,
                )
                raise  # re-raise → Inngest retries this step
            ctx.logger.error(
                "notify-reviewer failed after %d retries — notification lost: %s",
                SLACK_MAX_RETRIES,
                e,
            )
            raise inngest.NonRetriableError(
                f"reviewer notification lost after {SLACK_MAX_RETRIES} retries: {e}"
            ) from e

    notified = await ctx.step.run("notify-reviewer", _notify_reviewer)

    return {
        "customer_id": customer["id"],
        "tier": customer["tier"],
        "draft": draft,
        "audit_id": persisted["audit_id"],
        "persisted": persisted["persisted"],
        "degraded": persisted["degraded"],
        "notified": notified["notified"],
        "retry_policy": {
            "draft_attempts": draft_info["attempts"],
            "persist_attempts": persisted["attempts"],
            "notify_attempts": notified["attempts"],
        },
    }


# --- Tier lanes: reserved concurrency pools per tier (the SLA upgrade) -------
#
# The single shared-pool function could only REORDER tiers (priority); it could not
# guarantee Enterprise latency, because Enterprise still queued behind a full shared
# pool (measured: up to ~20s wait). These three lanes give each tier its OWN reserved
# pool, routed by a trigger `expression` on the enriched event.data.tier. The lanes
# PARTITION the event space — mutually exclusive and exhaustive: the free lane is the
# catch-all for any tier that is not enterprise/pro (incl. missing/unknown), so no
# event is ever dropped. Same body (_handle_support_email), different doors.
#
# Sizing (Postgres pool = 20 conns, 1/run): 4 + 6 + 6 = 16 in-flight max, ~4 conns
# headroom for the cron/migrations. Enterprise=4 is sized so the lane effectively
# never queues -> req #2 (low latency) by RESERVATION, not reordering. Per-customer
# cap=3 stays inside every lane -> req #4 (no single customer monopolizes its tier).
#
# OpenAI 30/min is an ACCOUNT-wide RATE, but throttle is per-function and does NOT
# coordinate across lanes, so the 30/min budget is SPLIT across the lanes (10 each)
# rather than set to 30 on each (which would permit 90/min combined).
#
# req #3 (Free not starved >60s): the reserved Free pool guarantees Free is never
# starved BY OTHER TIERS. Bounding ABSOLUTE Free wait also needs the Free pool sized
# for peak Free demand; the start-timeout below is a TRIPWIRE that surfaces a breach
# (it cancels a run that cannot start within 60s — a failure handler can alert on it):
# detection, not prevention. We deliberately do NOT put a cancelling start-timeout on
# the enterprise lane — dropping a high-value email to "enforce" 5s is worse than a
# slow reply; size the pool and alert via metrics instead.

@inngest_client.create_function(
    fn_id="support-email-enterprise",
    retries=SLACK_MAX_RETRIES,
    trigger=inngest.TriggerEvent(
        event="customer/email.received",
        expression="event.data.tier == 'enterprise'",
    ),
    throttle=inngest.Throttle(limit=10, period=datetime.timedelta(minutes=1)),
    concurrency=[
        inngest.Concurrency(limit=4),  # RESERVED enterprise pool — never shared (req #2)
        inngest.Concurrency(limit=3, key="event.data.customer_id"),  # req #4
    ],
)
async def support_email_enterprise(ctx: inngest.Context) -> dict:
    return await _handle_support_email(ctx)


@inngest_client.create_function(
    fn_id="support-email-pro",
    retries=SLACK_MAX_RETRIES,
    trigger=inngest.TriggerEvent(
        event="customer/email.received",
        expression="event.data.tier == 'pro'",
    ),
    throttle=inngest.Throttle(limit=10, period=datetime.timedelta(minutes=1)),
    concurrency=[
        inngest.Concurrency(limit=6),  # RESERVED pro pool
        inngest.Concurrency(limit=3, key="event.data.customer_id"),  # req #4
    ],
)
async def support_email_pro(ctx: inngest.Context) -> dict:
    return await _handle_support_email(ctx)


@inngest_client.create_function(
    fn_id="support-email-free",
    retries=SLACK_MAX_RETRIES,
    # Catch-all: free, plus any unknown/missing tier, so no event is ever dropped.
    trigger=inngest.TriggerEvent(
        event="customer/email.received",
        expression="event.data.tier != 'enterprise' && event.data.tier != 'pro'",
    ),
    throttle=inngest.Throttle(limit=10, period=datetime.timedelta(minutes=1)),
    concurrency=[
        inngest.Concurrency(limit=6),  # RESERVED free pool
        inngest.Concurrency(limit=3, key="event.data.customer_id"),  # req #4
    ],
    # NO cancelling start-timeout here, on purpose. A start-timeout would "meet" the
    # 60s SLA by CANCELLING (dropping) the email — verified locally: under a 9-email
    # flood with start=60s, 2 free emails were cancelled unprocessed, which violates
    # the course's "nothing is dropped; work queues" principle. req #3 is met by
    # SIZING this reserved pool for peak Free demand (so Free never queues behind
    # other tiers, and its own backlog drains inside the budget) and ALERTING on
    # queue depth — not by dropping work.
)
async def support_email_free(ctx: inngest.Context) -> dict:
    return await _handle_support_email(ctx)


# --- Weekly per-agent metrics (cron) ---------------------------------------
#
# Reads the audit_log. The minimal floor stores agent/status/timing inside the
# `detail` jsonb (no schema migration), with this action vocabulary:
#   - 'conversation_resolved' : detail = {agent_id, conversation_id, resolution_seconds}
#   - 'escalation'            : detail = {agent_id, ...}
#   - 'refund_issued'         : detail = {agent_id, ...}
# created_at is the time the action occurred (for resolved rows, the resolution time).

_METRICS_SQL = """
SELECT
  detail->>'agent_id' AS agent_id,
  count(*) FILTER (WHERE action = 'conversation_resolved')                                      AS conversations_resolved,
  avg((detail->>'resolution_seconds')::numeric) FILTER (WHERE action = 'conversation_resolved') AS avg_resolution_seconds,
  count(*) FILTER (WHERE action = 'escalation')                                                 AS escalations,
  count(*) FILTER (WHERE action = 'refund_issued')                                              AS refunds_issued
FROM audit_log
WHERE created_at >= %(start)s
  AND created_at <  %(end)s
  AND detail ? 'agent_id'
GROUP BY detail->>'agent_id'
ORDER BY agent_id
"""


def _prior_week_window(
    reference: datetime.datetime,
) -> tuple[datetime.datetime, datetime.datetime]:
    """Return [start, end) for the calendar week BEFORE the reference's week.

    Monday-anchored, UTC. For a Monday-09:00 cron fire this is exactly the
    just-completed Mon-Sun week.
    """
    midnight = reference.replace(hour=0, minute=0, second=0, microsecond=0)
    this_week_start = midnight - datetime.timedelta(days=reference.weekday())
    return this_week_start - datetime.timedelta(days=7), this_week_start


async def _compute_weekly_metrics(ctx: inngest.Context) -> dict:
    """Per-agent metrics for the prior week's audit_log.

    The window anchor is derived ONLY from stable event data — `as_of`, else the
    event's scheduled timestamp (`ctx.event.ts`). Both are frozen in the event, so
    the window is replay-stable by construction and needs no step wrapper. There is
    deliberately no `datetime.now()` fallback: a live clock reading would differ on
    every replay and silently desync the returned window from the memoized query.
    If neither anchor is present (a malformed manual invoke; a real cron always
    carries `ts`), we fail loud rather than metricize "now". The DB read is the
    side-effect, so it lives inside step.run and is memoized. Pass
    {"as_of": "2026-05-29T09:00:00+00:00"} to pin the window for manual testing.
    """
    data = ctx.event.data or {}
    as_of = data.get("as_of")
    if as_of:
        reference = datetime.datetime.fromisoformat(as_of)
    elif getattr(ctx.event, "ts", 0):
        reference = datetime.datetime.fromtimestamp(
            ctx.event.ts / 1000, tz=datetime.timezone.utc
        )
    else:
        raise inngest.NonRetriableError(
            "weekly-metrics needs a stable anchor: pass data.as_of or rely on "
            "the cron's event.ts (a live now() reading would diverge on replay)"
        )
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=datetime.timezone.utc)

    start, end = _prior_week_window(reference)

    def _query_metrics() -> list[dict]:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            rows = conn.execute(_METRICS_SQL, {"start": start, "end": end}).fetchall()
        # Cast to JSON-safe types (counts are ints, avg is a Decimal or None).
        return [
            {
                "agent_id": r["agent_id"],
                "conversations_resolved": int(r["conversations_resolved"]),
                "avg_resolution_seconds": (
                    round(float(r["avg_resolution_seconds"]), 1)
                    if r["avg_resolution_seconds"] is not None
                    else None
                ),
                "escalations": int(r["escalations"]),
                "refunds_issued": int(r["refunds_issued"]),
            }
            for r in rows
        ]

    per_agent_rows = await ctx.step.run("query-weekly-metrics", _query_metrics)

    return {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "agent_count": len(per_agent_rows),
        "total_conversations_resolved": sum(
            r["conversations_resolved"] for r in per_agent_rows
        ),
        "per_agent": {r["agent_id"]: r for r in per_agent_rows},
    }


@inngest_client.create_function(
    fn_id="weekly-agent-metrics",
    trigger=inngest.TriggerCron(cron="0 9 * * 1"),  # Mondays 09:00 UTC
)
async def weekly_agent_metrics(ctx: inngest.Context) -> dict:
    return await _compute_weekly_metrics(ctx)


# A cron-triggered function cannot be invoked ("function was not triggered by
# invoke event"), and adding an event trigger to the cron function does not lift
# that. So this event-triggered TWIN runs the identical logic and is what
# invoke_function / send_event target for manual, on-demand testing.
@inngest_client.create_function(
    fn_id="weekly-agent-metrics-run",
    trigger=inngest.TriggerEvent(event="demo/weekly_metrics.run"),
)
async def weekly_agent_metrics_run(ctx: inngest.Context) -> dict:
    return await _compute_weekly_metrics(ctx)


# --- Stripe: refund failed (webhook → async durable run) -------------------
#
# Triggered by `stripe/refund.failed`, which a webhook transform produces from
# Stripe's raw `{type:"charge.refund.updated", data:{object:{...}}}` envelope,
# flattened to the fields below. The endpoint just acks Stripe fast and emits
# this event; all real handling happens here in the background.
#
# Idempotency: send this event with id=<stripe_event_id> so a redelivered
# Stripe webhook is deduped by Inngest (24h window) and we record it once.
@inngest_client.create_function(
    fn_id="stripe-refund-failed",
    trigger=inngest.TriggerEvent(event="stripe/refund.failed"),
)
async def stripe_refund_failed(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    refund_id = data.get("refund_id")

    def _record_failure() -> dict:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            row = conn.execute(
                """
                INSERT INTO audit_log (customer_id, action, detail)
                VALUES (
                    (SELECT id FROM customers WHERE email = %(email)s),
                    'refund_failed',
                    %(detail)s
                )
                RETURNING id, customer_id
                """,
                {
                    "email": data.get("customer_email"),
                    "detail": Json(
                        {
                            "refund_id": refund_id,
                            "charge_id": data.get("charge_id"),
                            "customer_email": data.get("customer_email"),
                            "amount": data.get("amount"),
                            "failure_reason": data.get("failure_reason"),
                        }
                    ),
                },
            ).fetchone()
        return {"audit_id": int(row["id"]), "customer_id": row["customer_id"]}

    audit = await ctx.step.run("record-refund-failure", _record_failure)

    return {
        "handled": "stripe/refund.failed",
        "refund_id": refund_id,
        "audit_id": audit["audit_id"],
        "customer_matched": audit["customer_id"] is not None,
    }


# --- Delayed refund investigation (event → notify → durable wait → branch) ---
#
# Triggered by `customer/refund.failed`. A failed refund needs a human to look at
# it, but a human is not standing by, so the work is: tell on-call now, then
# durably suspend until either a human clicks "Investigate" or four hours pass.
# The suspension is the whole point. An in-process `asyncio.wait_for` would die
# with the worker; `step.wait_for_event` lives server-side, so the run survives a
# crash, a deploy, or a reviewer who takes three hours to get to it.
#
# Event data (the failed-refund details):
#   {refund_id, order_id?, customer_email?, amount?, failure_reason?}
#
# The flow:
#   1. notify-oncall      Slack message + "Investigate" button (logged in dev)  + audit
#   2. await-investigation  suspend up to 4h for the human's click event
#   3a. click in time  ->  draft-summary   run the agent, write the summary     + audit
#   3b. 4h elapsed     ->  escalate        fire `customer/refund.escalated`      + audit
#
# The load-bearing detail is the `if_exp` correlation filter on the wait. Without
# it, ANY `customer/refund.investigation_started` event would resume ANY waiting
# run, so a click on refund B would wake the run suspended on refund A. The CEL
# `event.data.refund_id == async.data.refund_id` ties the resume to THIS refund:
# `event` is the trigger (this run's refund.failed), `async` is the candidate
# incoming click event. (The reference page documents `if_exp`; the older
# multi-step guide still shows the `match=` shorthand, which builds the same CEL.)
@inngest_client.create_function(
    fn_id="refund-investigation",
    trigger=inngest.TriggerEvent(event="customer/refund.failed"),
)
async def refund_investigation(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    refund_id = data.get("refund_id")
    order_id = data.get("order_id")
    customer_email = data.get("customer_email")
    amount = data.get("amount")
    failure_reason = data.get("failure_reason", "(no reason given)")

    if not refund_id:
        # No refund_id means the wait could never correlate a resume — fail loud
        # and permanently rather than suspend a run nothing can ever wake.
        raise inngest.NonRetriableError(
            "customer/refund.failed needs data.refund_id to correlate the "
            "investigation click (if_exp matches on refund_id)"
        )

    # Audit helper: write one row, linking the customer by email when we can. The
    # customer_id subquery yields NULL for an unknown/absent email (the column is
    # nullable), exactly as the stripe-refund-failed handler does. Action and its
    # audit row commit in one transaction, per AGENTS.md.
    def _audit(action: str, detail: dict) -> int:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            row = conn.execute(
                """
                INSERT INTO audit_log (customer_id, action, detail)
                VALUES (
                    (SELECT id FROM customers WHERE email = %(email)s),
                    %(action)s,
                    %(detail)s
                )
                RETURNING id
                """,
                {"email": customer_email, "action": action, "detail": Json(detail)},
            ).fetchone()
        return int(row["id"])

    # --- Step 1: notify on-call with the refund details + an Investigate button --
    # In prod this is a Slack Block Kit message whose button posts the click event
    # (customer/refund.investigation_started) back to Inngest. In dev we simulate
    # the Slack call with a log line and record it in the audit log.
    def _notify_oncall() -> dict:
        button_hint = (
            "[Investigate] -> sends customer/refund.investigation_started "
            f'with data.refund_id="{refund_id}"'
        )
        message = (
            f"🔴 Refund FAILED for {customer_email or 'unknown customer'} "
            f"(refund {refund_id}, order {order_id}, amount {amount}). "
            f"Reason: {failure_reason}. {button_hint}"
        )
        ctx.logger.info("oncall-slack: %s", message)
        audit_id = _audit(
            "investigation_notified",
            {
                "refund_id": refund_id,
                "order_id": order_id,
                "amount": amount,
                "failure_reason": failure_reason,
            },
        )
        return {"notified": True, "audit_id": audit_id, "message": message}

    notified = await ctx.step.run("notify-oncall", _notify_oncall)

    # --- Step 2: suspend until the human clicks, or 4 hours pass ----------------
    # Returns the investigation_started event if it arrives in time, else None.
    # if_exp scopes the resume to THIS refund; timeout is the hard 4h ceiling.
    # Production wait is a hard 4h. `timeout_seconds` in the event data overrides
    # it ONLY for testing the escalation branch without waiting four real hours —
    # it lives in the (frozen) event, so the timeout is replay-stable either way.
    timeout = (
        datetime.timedelta(seconds=data["timeout_seconds"])
        if data.get("timeout_seconds") is not None
        else datetime.timedelta(hours=4)
    )
    investigation = await ctx.step.wait_for_event(
        "await-investigation",
        event="customer/refund.investigation_started",
        if_exp="event.data.refund_id == async.data.refund_id",
        timeout=timeout,
    )

    # wait_for_event returns an inngest.Event (has .data); be defensive about shape
    # so a future SDK that returns a plain dict does not break the branch.
    def _event_data(evt: object) -> dict:
        if evt is None:
            return {}
        payload = getattr(evt, "data", None)
        if payload is None and isinstance(evt, dict):
            payload = evt.get("data")
        return payload or {}

    # --- Step 3b: timeout -> escalate to a senior reviewer ----------------------
    if investigation is None:
        escalate_audit = await ctx.step.run(
            "record-escalation",
            lambda: _audit(
                "investigation_escalated",
                {
                    "refund_id": refund_id,
                    "order_id": order_id,
                    "amount": amount,
                    "failure_reason": failure_reason,
                    "reason": "no human picked up the investigation within 4h",
                },
            ),
        )
        # Fire the escalation event. The idempotency id means a replay of this run
        # cannot fan out a second escalation at the real-world boundary (step
        # memoization protects within the run; the id protects across replays).
        await ctx.step.send_event(
            "escalate",
            inngest.Event(
                name="customer/refund.escalated",
                data={
                    "refund_id": refund_id,
                    "order_id": order_id,
                    "customer_email": customer_email,
                    "amount": amount,
                    "failure_reason": failure_reason,
                    "escalation_reason": "investigation_timeout_4h",
                },
                id=f"refund-escalation-{refund_id}",
            ),
        )
        return {
            "outcome": "escalated",
            "refund_id": refund_id,
            "reason": "no human click within 4h",
            "notify_audit_id": notified["audit_id"],
            "escalation_audit_id": escalate_audit,
        }

    # --- Step 3a: human clicked in time -> run the agent to draft a summary -----
    investigator = _event_data(investigation).get("investigator", "on-call engineer")

    async def _draft_summary() -> str:
        prompt = (
            f"Failed refund {refund_id} (order {order_id}) for "
            f"{customer_email or 'unknown customer'}, amount {amount}.\n"
            f"Failure reason: {failure_reason}\n"
            f"Picked up by: {investigator}\n\n"
            "Write the investigation summary."
        )
        result = await Runner.run(investigation_agent, prompt)
        return result.final_output

    summary = await ctx.step.run("draft-summary", _draft_summary)

    summary_audit = await ctx.step.run(
        "record-summary",
        lambda: _audit(
            "investigation_summary",
            {"refund_id": refund_id, "investigator": investigator, "summary": summary},
        ),
    )

    return {
        "outcome": "investigated",
        "refund_id": refund_id,
        "investigator": investigator,
        "summary": summary,
        "notify_audit_id": notified["audit_id"],
        "summary_audit_id": summary_audit,
    }


# --- Batched ticket embedding (event → ONE batched durable run) -------------
#
# Converts a would-be PER-TICKET handler into ONE batched run. The naive shape
# is one invocation per `ticket/resolved` event = one OpenAI request per ticket;
# at 50 resolved tickets that is 50 requests, 50x the per-request overhead, and
# 50 hits against the rate limit. Batching collapses up to 50 events into a
# single run that makes ONE embeddings request with a 50-text input list —
# faster (one round trip) and cheaper (one request's fixed overhead).
#
# Batching config: max_size=50 OR timeout=30s, whichever comes first — a burst
# fills a batch of 50 at once; a quiet trickle still drains within 30s. The
# handler reads the WHOLE batch from `ctx.events` (a LIST), not `ctx.event`.
#
# Two different "batch" things live in the OpenAI SDK — we use the right one:
#   * embeddings.create(input=[...50 strings...]) -> ONE synchronous request,
#     all 50 vectors back in `resp.data`, ordered by `.index`. THIS is ours.
#   * client.batches.create(...)                  -> the file-based 24h Batch
#     API (offline, ~50% cheaper). Wrong tool here: we want the vectors now.
#
# Flow-control note: batching does NOT combine with throttle / rate-limiting /
# idempotency-config / priority (per the batching guide), so this function
# carries none of those. Per-ticket emit de-dup lives on the send_event `id`.
#
# Storage: the embedding is written as jsonb (a JSON list of floats). The floor
# has no pgvector (per AGENTS.md); for similarity SEARCH in production you would
# store a `vector(1536)` column with a cosine index. Here we only need to STORE.
#
# Event in:  ticket/resolved  data={ticket_id}   (body is loaded from DB, not the event)
# Event out: ticket/embedded  data={ticket_id, customer_id, dim, model}  (one per ticket)
# Keyless test knob: any event in the batch with data.embed_stub=true skips the
#   paid OpenAI call and stores a small deterministic stub vector instead.

EMBED_MODEL = "text-embedding-3-small"


@inngest_client.create_function(
    fn_id="embed-resolved-tickets",
    trigger=inngest.TriggerEvent(event="ticket/resolved"),
    batch_events=inngest.Batch(
        max_size=50,
        timeout=datetime.timedelta(seconds=30),
    ),
)
async def embed_resolved_tickets(ctx: inngest.Context) -> dict:
    # Derive the work list from the FROZEN batch events (deterministic on replay):
    # dedupe ticket_ids and notice if any event asked for the stub path. Done
    # OUTSIDE any step so it re-derives identically on every retry.
    ticket_ids: list[int] = []
    seen: set[int] = set()
    stub = False
    for evt in ctx.events:
        data = evt.data or {}
        if data.get("embed_stub"):
            stub = True
        tid = data.get("ticket_id")
        if tid is None:
            continue
        tid = int(tid)
        if tid not in seen:
            seen.add(tid)
            ticket_ids.append(tid)

    if not ticket_ids:
        return {"batch_size": len(ctx.events), "embedded": 0, "note": "no ticket_id in batch"}

    # --- Step 1: load the ticket bodies in ONE query ------------------------
    # Only rows still missing an embedding: a redelivered/duplicate ticket/resolved
    # event for an already-embedded ticket is filtered out here (idempotency at the
    # read), so we never pay to embed the same ticket twice.
    def _load_bodies() -> list[dict]:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            rows = conn.execute(
                """
                SELECT id, customer_id, body
                FROM tickets
                WHERE id = ANY(%(ids)s) AND embedding IS NULL
                ORDER BY id
                """,
                {"ids": ticket_ids},
            ).fetchall()
        return [
            {"id": int(r["id"]), "customer_id": r["customer_id"], "body": r["body"]}
            for r in rows
        ]

    tickets = await ctx.step.run("load-bodies", _load_bodies)

    requested = len(ticket_ids)
    if not tickets:
        # Everything in this batch was already embedded (or the ids are unknown).
        # Log it so a quiet result is never mistaken for silently dropped work.
        ctx.logger.info(
            "embed-resolved-tickets: batch of %d ticket(s), 0 to embed "
            "(already embedded or unknown ids)",
            requested,
        )
        return {"batch_size": len(ctx.events), "requested": requested, "embedded": 0}

    # --- Step 2: ONE embeddings request for the whole batch -----------------
    # The paid call lives INSIDE step.run, so it is memoized: a retry of a later
    # step never re-bills these embeddings. input order is the `tickets` order; we
    # re-key the response by `.index` so a reordered response can't misalign vectors.
    bodies = [t["body"] for t in tickets]

    async def _embed_batch() -> list[list[float]]:
        if stub:
            # Deterministic 8-dim stub — verifies the whole pipeline with no
            # OPENAI_API_KEY and no spend; length encodes the body so vectors differ.
            return [[float(len(b)), 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0] for b in bodies]
        client = openai.AsyncOpenAI()
        resp = await client.embeddings.create(model=EMBED_MODEL, input=bodies)
        ordered = sorted(resp.data, key=lambda d: d.index)
        return [d.embedding for d in ordered]

    vectors = await ctx.step.run("embed-batch", _embed_batch)

    # Pair each ticket with its vector by position (both came from `tickets` order).
    embedded_model = "stub-8d" if stub else EMBED_MODEL
    pairs = [
        {"id": t["id"], "customer_id": t["customer_id"], "vector": v}
        for t, v in zip(tickets, vectors)
    ]
    dim = len(vectors[0]) if vectors else 0

    # --- Step 3: store embeddings + audit, in ONE transaction ----------------
    # One UPDATE drives all rows from a single unnest; one INSERT writes a
    # 'ticket_embedded' audit row per ticket. The action and its audit rows commit
    # together (per AGENTS.md). Vectors/details cross the wire as text[] of JSON and
    # are cast to jsonb in SQL — robust and adapter-agnostic.
    def _store() -> int:
        ids = [p["id"] for p in pairs]
        embs = [json.dumps(p["vector"]) for p in pairs]
        cids = [p["customer_id"] for p in pairs]
        details = [
            json.dumps({"ticket_id": p["id"], "model": embedded_model, "dim": dim})
            for p in pairs
        ]
        with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
            with conn.transaction():
                conn.execute(
                    """
                    UPDATE tickets AS t
                    SET embedding = u.embedding::jsonb,
                        embedding_model = %(model)s,
                        embedded_at = now()
                    FROM unnest(%(ids)s::bigint[], %(embs)s::text[]) AS u(id, embedding)
                    WHERE t.id = u.id
                    """,
                    {"ids": ids, "embs": embs, "model": embedded_model},
                )
                conn.execute(
                    """
                    INSERT INTO audit_log (customer_id, action, detail)
                    SELECT u.customer_id, 'ticket_embedded', u.detail::jsonb
                    FROM unnest(%(cids)s::bigint[], %(details)s::text[]) AS u(customer_id, detail)
                    """,
                    {"cids": cids, "details": details},
                )
        return len(pairs)

    stored = await ctx.step.run("store-embeddings", _store)

    # --- Step 4: emit one ticket/embedded event per ticket -------------------
    # ONE send_event call with a LIST fans out N downstream events. The per-ticket
    # idempotency id stops a replay of THIS run from emitting a second event at the
    # real-world boundary (step memo protects within a run; the id protects across).
    out_events = [
        inngest.Event(
            name="ticket/embedded",
            data={
                "ticket_id": p["id"],
                "customer_id": p["customer_id"],
                "dim": dim,
                "model": embedded_model,
            },
            id=f"ticket-embedded-{p['id']}",
        )
        for p in pairs
    ]
    await ctx.step.send_event("emit-embedded", out_events)

    ctx.logger.info(
        "embed-resolved-tickets: batch=%d requested=%d embedded=%d "
        "(1 OpenAI request, dim=%d)",
        len(ctx.events), requested, stored, dim,
    )
    return {
        "batch_size": len(ctx.events),
        "requested": requested,
        "embedded": stored,
        "skipped_already_embedded": requested - stored,
        "dim": dim,
        "model": embedded_model,
        "ticket_ids": [p["id"] for p in pairs],
    }


# --- Durable refund-approval gate (event → notify → durable wait → branch) ---
#
# Spec: the agent decides a refund is warranted, but ISSUING it needs a human's
# OK. This gate makes that approval DURABLE — notify the reviewer, suspend up to
# 4h with step.wait_for_event, then branch on the decision. An in-process pause
# (asyncio.wait_for) would die with the worker; this one survives a crash, a
# deploy, or a reviewer who takes hours.
#
#   1. investigate       run the agent -> recommendation
#   2. notify-reviewer   Slack-style approve/reject ask    (+ refund_review_requested)
#   3. await-decision    suspend <=4h for customer/refund.decision (if_exp on refund_id)
#   4a. approve  -> issue-refund (idempotent at the boundary) (+ refund_issued)
#   4b. reject   -> record blocked                            (+ refund_blocked reason=reviewer_rejected)
#   4c. timeout  -> record blocked                            (+ refund_blocked reason=timeout_4h)
#
# Idempotency at the external boundary (what a REPLAY/retry needs): the refund is
# recorded in a `refunds` ledger keyed by a DETERMINISTIC idempotency_key
# (order_id + refund_id, computed OUTSIDE the step from frozen event data). The
# issue step INSERTs ON CONFLICT (idempotency_key) DO NOTHING: step memo protects
# WITHIN a run, the UNIQUE key protects ACROSS replays/retries -> the customer is
# refunded exactly once no matter how many times the run re-executes. Ledger row
# and its audit row commit in ONE transaction (per AGENTS.md).
#
# Action vocabulary (small + fixed): refund_review_requested, refund_issued, refund_blocked.
# Event in:       customer/refund.requested  {refund_id, order_id, customer_email, amount, reason?}
# Decision event: customer/refund.decision   {refund_id, decision: "approve"|"reject", reviewer?, note?}
# Test knobs: investigate_stub=true (skip the paid agent call); timeout_seconds=N
#   (shrink the 4h wait so the timeout branch is testable without waiting 4 hours).
@inngest_client.create_function(
    fn_id="refund-approval-gate",
    trigger=inngest.TriggerEvent(event="customer/refund.requested"),
)
async def refund_approval_gate(ctx: inngest.Context) -> dict:
    data = ctx.event.data or {}
    refund_id = data.get("refund_id")
    order_id = data.get("order_id")
    customer_email = data.get("customer_email")
    amount = data.get("amount")
    reason = data.get("reason", "(no reason given)")

    if not refund_id or not order_id:
        # refund_id correlates the decision; order_id+refund_id is the idempotency
        # key. Missing either means the gate could never resume or never dedupe —
        # fail loud and permanently rather than suspend a run nothing can settle.
        raise inngest.NonRetriableError(
            "customer/refund.requested needs data.refund_id and data.order_id"
        )

    # Deterministic idempotency key for the refund's external effect, computed
    # OUTSIDE any step from frozen event data so a replay derives the SAME key.
    idem_key = f"{order_id}:{refund_id}"

    def _audit(action: str, detail: dict) -> int:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            row = conn.execute(
                """
                INSERT INTO audit_log (customer_id, action, detail)
                VALUES (
                    (SELECT id FROM customers WHERE email = %(email)s),
                    %(action)s,
                    %(detail)s
                )
                RETURNING id
                """,
                {"email": customer_email, "action": action, "detail": Json(detail)},
            ).fetchone()
        return int(row["id"])

    # --- Step 1: the agent investigates and recommends ----------------------
    async def _investigate() -> str:
        if data.get("investigate_stub"):
            return (
                f"[stub] Recommend REFUND of {amount} for order {order_id}: "
                f"{reason}."
            )
        prompt = (
            f"Refund request {refund_id} for order {order_id}, customer "
            f"{customer_email or 'unknown'}, amount {amount}.\n"
            f"Context: {reason}\n\n"
            "Investigate and write a short recommendation to the on-call reviewer "
            "on whether to approve this refund."
        )
        result = await Runner.run(investigation_agent, prompt)
        return result.final_output

    recommendation = await ctx.step.run("investigate", _investigate)

    # --- Step 2: notify the reviewer + audit review_requested ----------------
    def _notify() -> int:
        button_hint = (
            "[Approve]/[Reject] -> send customer/refund.decision with "
            f'data.refund_id="{refund_id}", data.decision="approve"|"reject"'
        )
        message = (
            f"🟠 Refund APPROVAL needed: {amount} for {customer_email or 'unknown'} "
            f"(refund {refund_id}, order {order_id}).\n"
            f"Agent recommendation: {recommendation}\n{button_hint}"
        )
        ctx.logger.info("reviewer-approval-request: %s", message)
        return _audit(
            "refund_review_requested",
            {
                "refund_id": refund_id,
                "order_id": order_id,
                "amount": amount,
                "recommendation": recommendation,
            },
        )

    review_audit = await ctx.step.run("notify-reviewer", _notify)

    # --- Step 3: suspend up to 4h for the reviewer's decision ----------------
    # if_exp scopes the resume to THIS refund (event = this run's request, async =
    # the candidate decision event); timeout is the hard ceiling. timeout_seconds
    # overrides 4h ONLY for testing the timeout branch — it lives in the frozen
    # event, so the wait is replay-stable either way.
    timeout = (
        datetime.timedelta(seconds=data["timeout_seconds"])
        if data.get("timeout_seconds") is not None
        else datetime.timedelta(hours=4)
    )
    decision_event = await ctx.step.wait_for_event(
        "await-decision",
        event="customer/refund.decision",
        if_exp="event.data.refund_id == async.data.refund_id",
        timeout=timeout,
    )

    def _decision_data(evt: object) -> dict:
        if evt is None:
            return {}
        payload = getattr(evt, "data", None)
        if payload is None and isinstance(evt, dict):
            payload = evt.get("data")
        return payload or {}

    # --- Step 4c: timeout -> blocked refund ---------------------------------
    if decision_event is None:
        blocked_audit = await ctx.step.run(
            "record-timeout-block",
            lambda: _audit(
                "refund_blocked",
                {
                    "refund_id": refund_id,
                    "order_id": order_id,
                    "amount": amount,
                    "reason": "timeout_4h",
                    "decided_by": "system",
                },
            ),
        )
        return {
            "outcome": "blocked",
            "reason": "timeout_4h",
            "refund_id": refund_id,
            "review_audit_id": review_audit,
            "blocked_audit_id": blocked_audit,
        }

    decision = (_decision_data(decision_event).get("decision") or "").lower()
    reviewer = _decision_data(decision_event).get("reviewer", "on-call reviewer")
    note = _decision_data(decision_event).get("note")

    # --- Step 4b: reject -> blocked refund ----------------------------------
    # Anything that is not an explicit "approve" blocks: we never issue on an
    # ambiguous decision.
    if decision != "approve":
        blocked_audit = await ctx.step.run(
            "record-reject-block",
            lambda: _audit(
                "refund_blocked",
                {
                    "refund_id": refund_id,
                    "order_id": order_id,
                    "amount": amount,
                    "reason": "reviewer_rejected",
                    "decided_by": reviewer,
                    "note": note,
                },
            ),
        )
        return {
            "outcome": "blocked",
            "reason": "reviewer_rejected",
            "refund_id": refund_id,
            "reviewer": reviewer,
            "review_audit_id": review_audit,
            "blocked_audit_id": blocked_audit,
        }

    # --- Step 4a: approve -> issue the refund (idempotent) + audit -----------
    # ON CONFLICT DO NOTHING on the UNIQUE idempotency_key means a replay/retry
    # cannot issue a second refund. RETURNING distinguishes first-issue (a row)
    # from already-issued (no row). Ledger row + audit row commit together; on an
    # idempotent no-op we deliberately write NEITHER a second ledger row NOR a
    # second refund_issued audit.
    def _issue_refund() -> dict:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
            with conn.transaction():
                row = conn.execute(
                    """
                    INSERT INTO refunds
                        (idempotency_key, refund_id, order_id, customer_email,
                         amount, status, reviewer)
                    VALUES
                        (%(key)s, %(rid)s, %(oid)s, %(email)s, %(amount)s,
                         'issued', %(reviewer)s)
                    ON CONFLICT (idempotency_key) DO NOTHING
                    RETURNING id
                    """,
                    {
                        "key": idem_key,
                        "rid": refund_id,
                        "oid": order_id,
                        "email": customer_email,
                        "amount": amount,
                        "reviewer": reviewer,
                    },
                ).fetchone()
                if row is None:
                    return {"issued": False, "refund_row_id": None, "audit_id": None}
                audit = conn.execute(
                    """
                    INSERT INTO audit_log (customer_id, action, detail)
                    VALUES (
                        (SELECT id FROM customers WHERE email = %(email)s),
                        'refund_issued',
                        %(detail)s
                    )
                    RETURNING id
                    """,
                    {
                        "email": customer_email,
                        "detail": Json(
                            {
                                "refund_id": refund_id,
                                "order_id": order_id,
                                "amount": amount,
                                "decided_by": reviewer,
                                "idempotency_key": idem_key,
                            }
                        ),
                    },
                ).fetchone()
                return {
                    "issued": True,
                    "refund_row_id": int(row["id"]),
                    "audit_id": int(audit["id"]),
                }

    issue = await ctx.step.run("issue-refund", _issue_refund)

    return {
        "outcome": "issued" if issue["issued"] else "already_issued",
        "refund_id": refund_id,
        "idempotency_key": idem_key,
        "reviewer": reviewer,
        "review_audit_id": review_audit,
        "refund_row_id": issue["refund_row_id"],
    }


app = fastapi.FastAPI()


@app.get("/debug/step-executions/{run_id}")
def step_executions(run_id: str) -> dict:
    """Which step bodies actually executed for a run (memoization probe)."""
    executed = STEP_EXECUTIONS.get(run_id, [])
    counts: dict[str, int] = {}
    for entry in executed:
        name = entry.split("@", 1)[0]
        counts[name] = counts.get(name, 0) + 1
    return {"run_id": run_id, "executed": executed, "counts": counts}


@app.get("/debug/step-executions")
def step_executions_all() -> dict:
    """All recorded runs (memoization probe), in insertion order.

    Per run: the ordered list of step bodies that actually executed (memoized
    bodies are absent) and a per-step execution count. Lets us prove the per-step
    retry counts without depending on the MCP's truncated run_id output.
    """
    out = {}
    for run_id, executed in STEP_EXECUTIONS.items():
        counts: dict[str, int] = {}
        for entry in executed:
            name = entry.split("@", 1)[0]
            counts[name] = counts.get(name, 0) + 1
        out[run_id] = {"executed": executed, "counts": counts}
    return {"runs": out, "run_count": len(out)}


inngest.fast_api.serve(
    app,
    inngest_client,
    [
        greet_customer,
        support_email_enterprise,
        support_email_pro,
        support_email_free,
        weekly_agent_metrics,
        weekly_agent_metrics_run,
        stripe_refund_failed,
        refund_investigation,
        embed_resolved_tickets,
        refund_approval_gate,
    ],
)

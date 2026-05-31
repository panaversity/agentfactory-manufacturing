"""The floor: a minimal customer-support agent (OpenAI Agents SDK).

This is the smallest Worker the Inngest nervous system can later wrap. It does
exactly four things, and it exists to be wrapped, not shipped:

  * reads the customer (id + tier) from the Neon `customers` table by sender email
  * drafts a warm reply to an incoming customer email
  * can `issue_refund`, gated on human approval (@function_tool(needs_approval=True))
  * writes an audit row for EVERY action, from a small fixed vocabulary

The one thing a later prompt makes durable is the agent invocation — the
`await Runner.run(...)` call below. The approval pause here is *ephemeral*: it
lives only as long as this process. Making it survive a crash or a slow reviewer
is the nervous system's job (step.wait_for_event), not the floor's.

Run:  uv run python agent.py            # normal support email -> drafts a reply
      uv run python agent.py refund     # refund-request email -> approval gate fires
"""

import asyncio
import json
import os
import sys

import psycopg
from agents import Agent, RunContextWrapper, Runner, function_tool
from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg.types.json import Json

# Load DATABASE_URL + OPENAI_API_KEY from .env (the SDK reads OPENAI_API_KEY from
# the env this populates; we never put either in code or logs).
load_dotenv()

# The small, fixed action vocabulary. Every audit row uses exactly one of these,
# and we do not drift it — a stable vocabulary is what makes the audit_log
# queryable later (e.g. the weekly per-agent metrics in the wrapped build).
ACTION_EMAIL_RECEIVED = "email_received"
ACTION_CUSTOMER_LOOKED_UP = "customer_looked_up"
ACTION_DRAFT_CREATED = "draft_created"
ACTION_HEALTH_CHECK = "health_check"
ACTION_REFUND_REQUESTED = "refund_requested"  # logged when a run SUSPENDS for approval
ACTION_REFUND_ISSUED = "refund_issued"
ACTION_REFUND_BLOCKED = "refund_blocked"


# --- Neon access: a narrow, typed interface (never a broad run_sql) ----------

def _connect() -> psycopg.Connection:
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def write_audit(customer_id: int | None, action: str, detail: dict) -> int:
    """Write one audit row and return its id. Used for every meaningful action."""
    with _connect() as conn:
        row = conn.execute(
            """
            INSERT INTO audit_log (customer_id, action, detail)
            VALUES (%(cid)s, %(action)s, %(detail)s)
            RETURNING id
            """,
            {"cid": customer_id, "action": action, "detail": Json(detail)},
        ).fetchone()
    return int(row["id"])


def issue_refund_audit(
    customer_id: int | None, detail: dict, idempotency_key: str
) -> int | None:
    """Write the refund_issued row ONLY if this idempotency_key has none yet.

    This is the real-world-boundary complement to Inngest step memoization, and the
    thing that makes the refund's idempotency_key load-bearing rather than cosmetic.
    Memoization stops a step from re-RUNNING within one run; this guard stops a
    SECOND refund across *separate* runs/retries that share the same key (e.g. the
    same `request_id` re-driven, or a manual replay). The INSERT ... SELECT ... WHERE
    NOT EXISTS makes the write conditional on the key being absent; .fetchone() is
    None when a matching refund already exists, so the caller can report a no-op
    instead of double-issuing. (For true concurrent double-fire a UNIQUE partial
    index on (detail->>'idempotency_key') WHERE action='refund_issued' is the
    production hardening; refunds here are human-gated and effectively serial.)
    """
    with _connect() as conn:
        row = conn.execute(
            """
            INSERT INTO audit_log (customer_id, action, detail)
            SELECT %(cid)s, %(action)s, %(detail)s
            WHERE NOT EXISTS (
                SELECT 1 FROM audit_log
                WHERE action = %(action)s
                  AND detail->>'idempotency_key' = %(key)s
            )
            RETURNING id
            """,
            {
                "cid": customer_id,
                "action": ACTION_REFUND_ISSUED,
                "detail": Json(detail),
                "key": idempotency_key,
            },
        ).fetchone()
    return int(row["id"]) if row else None


def seed_customers_if_empty() -> int:
    """Seed five sample customers only when the table is empty. Returns row count."""
    sample = [
        ("alice.c@example.com", "pro"),
        ("bob.c@example.com", "enterprise"),
        ("carol.c@example.com", "free"),
        ("dan.c@example.com", "pro"),
        ("erin.c@example.com", "enterprise"),
    ]
    with _connect() as conn:
        count = conn.execute("SELECT count(*) AS n FROM customers").fetchone()["n"]
        if count == 0:
            conn.executemany(
                "INSERT INTO customers (email, tier) VALUES (%s, %s)", sample
            )
            count = len(sample)
    return int(count)


def get_customer(email: str) -> dict | None:
    """Read a customer row (id, email, tier) by email, or None if unknown."""
    with _connect() as conn:
        return conn.execute(
            "SELECT id, email, tier FROM customers WHERE email = %(email)s",
            {"email": email},
        ).fetchone()


def get_eligible_customers() -> list[dict]:
    """Read the Pro/Enterprise customers — the daily health-check fan-out targets.

    Free-tier customers are excluded by the WHERE clause, so the cron never emits
    a health-check event for them.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT id, email, tier FROM customers "
            "WHERE tier IN ('pro', 'enterprise') ORDER BY id"
        ).fetchall()


# --- Agent context: what the tools get that the MODEL must not invent --------
#
# The customer's id is a fact we resolved from Neon, not something the model
# should guess. Passing it on the run context means issue_refund always audits
# against the RIGHT customer, regardless of what the model puts in its arguments.
class SupportContext:
    def __init__(
        self,
        customer_id: int | None,
        customer_email: str,
        idempotency_key: str | None = None,
    ):
        self.customer_id = customer_id
        self.customer_email = customer_email
        # The refund's real-world-boundary key. Step memoization makes the refund
        # fire once WITHIN a run; this key is what an external payment system would
        # dedupe on across replays/retries. It rides on the context so it survives
        # RunState serialization and is stamped onto the refund audit row.
        self.idempotency_key = idempotency_key


# --- The one approval-gated tool ---------------------------------------------
#
# needs_approval=True means the SDK does NOT run this body when the model calls
# it. Instead Runner.run returns with `result.interruptions` populated, and a
# human decides. The body below executes only AFTER approval, so reaching it is
# itself proof the refund was approved.
@function_tool(needs_approval=True)
def issue_refund(ctx: RunContextWrapper[SupportContext], amount: float, reason: str) -> str:
    """Issue a refund to the customer. Requires human approval before it runs.

    Args:
        amount: refund amount in US dollars.
        reason: short justification shown to the reviewer and recorded in the audit log.
    """
    sc = ctx.context
    key = getattr(sc, "idempotency_key", None)
    detail = {
        "customer_email": sc.customer_email,
        "amount": amount,
        "reason": reason,
        "idempotency_key": key,
    }
    # With a key, the write is idempotent at the boundary: a second refund for the
    # same key is a deliberate no-op (returns None). Without a key, fall back to a
    # plain write (the floor's own `agent.py refund` demo path passes no key).
    audit_id = (
        issue_refund_audit(sc.customer_id, detail, key)
        if key
        else write_audit(sc.customer_id, ACTION_REFUND_ISSUED, detail)
    )
    if audit_id is None:
        return (
            f"Refund of ${amount:.2f} for {sc.customer_email} was ALREADY issued "
            f"(idempotent no-op; key {key}). No second refund was made."
        )
    return (
        f"Refund of ${amount:.2f} issued to {sc.customer_email} "
        f"(reason: {reason}; audit #{audit_id})."
    )


support_agent = Agent[SupportContext](
    name="SupportAgent",
    instructions=(
        "You are a warm, concise customer-support agent. Given an incoming "
        "customer email and the customer's tier, write a friendly reply that "
        "acknowledges their issue, sounds human, and proposes a clear next step. "
        "When the email reports a duplicate charge, an overcharge, or a clearly "
        "failed/duplicate order, you MUST call issue_refund(amount, reason) — do "
        "not merely promise to look into it or say a refund is being processed. A "
        "human approves the refund before it actually runs, so never state the "
        "refund is already done. If a refund you requested is rejected or not "
        "approved, you MUST tell the customer their refund could not be approved "
        "and that you will follow up — never tell a customer a refund is on the "
        "way after it was rejected. For anything else, just write the reply. Output "
        "only the reply body — no subject line, no preamble."
    ),
    tools=[issue_refund],
    model="gpt-4o-mini",
)


def _refund_args(item) -> dict:
    """Best-effort parse of the pending refund tool call's arguments (JSON)."""
    raw = getattr(item, "raw_item", None)
    arguments = getattr(raw, "arguments", None)
    if isinstance(arguments, str):
        try:
            return json.loads(arguments)
        except json.JSONDecodeError:
            return {}
    return arguments or {}


async def handle_email(email: dict, *, refund_decision: str = "reject") -> str:
    """Run the floor on one incoming email and return the drafted reply.

    `refund_decision` ("approve" | "reject") stands in for the human at the
    approval gate. On the floor it is a parameter; in the wrapped build it
    becomes a durable decision event that resumes a suspended run.
    """
    from_email = email["from_email"]
    subject = email.get("subject", "(no subject)")
    body = email.get("body", "")

    # Action 1 — look up the customer (a read, but a recorded action).
    customer = get_customer(from_email)
    if customer is None:
        raise SystemExit(f"No customer on file for {from_email!r}.")
    write_audit(
        customer["id"],
        ACTION_CUSTOMER_LOOKED_UP,
        {"email": from_email, "tier": customer["tier"], "subject": subject},
    )

    sc = SupportContext(customer_id=customer["id"], customer_email=from_email)
    prompt = (
        f"Customer: {from_email} (tier: {customer['tier']})\n"
        f"Subject: {subject}\n"
        f"Email body:\n{body}\n\n"
        "Write the reply."
    )

    # The agent invocation. THIS is what a later prompt wraps in step.run to make
    # durable. Here it is a plain in-process call.
    result = await Runner.run(support_agent, prompt, context=sc)

    # The approval gate. While the model wants to issue a refund, Runner.run
    # returns with pending interruptions instead of running the tool. We decide,
    # then resume. This loop is ephemeral — a crash here loses the pending refund,
    # which is exactly the gap the nervous system closes with step.wait_for_event.
    #
    # Resume with `Runner.run(agent, state)` and NO context= : approve()/reject()
    # record the decision on the STATE's own context, so re-passing a fresh context
    # would wipe the decision and the same approval would loop forever. The round
    # cap is a hard stop so a misbehaving model can never run the paid tool unbounded.
    max_rounds = 5
    rounds = 0
    while result.interruptions:
        rounds += 1
        if rounds > max_rounds:
            raise SystemExit(
                f"Approval gate did not settle after {max_rounds} rounds — aborting "
                "rather than risk an unbounded loop."
            )
        state = result.to_state()
        for item in result.interruptions:
            if refund_decision == "approve":
                print(f"  [approval gate] APPROVED {item.tool_name} -> running it")
                state.approve(item)
            else:
                args = _refund_args(item)
                print(f"  [approval gate] REJECTED {item.tool_name} {args}")
                # The tool body will NOT run, so its refund_issued audit never
                # fires; we record the block here instead.
                write_audit(
                    sc.customer_id,
                    ACTION_REFUND_BLOCKED,
                    {
                        "customer_email": from_email,
                        "amount": args.get("amount"),
                        "reason": args.get("reason"),
                        "blocked_by": "reviewer_rejected",
                    },
                )
                state.reject(item)
        result = await Runner.run(support_agent, state)

    reply = result.final_output

    # Action 2 — record the finished draft.
    write_audit(
        customer["id"],
        ACTION_DRAFT_CREATED,
        {"subject": subject, "draft": reply},
    )
    return reply


# Two sample emails: a normal support question (the headline demo) and a refund
# request (exercises the approval gate).
SAMPLE_EMAILS = {
    "normal": {
        "from_email": "alice.c@example.com",
        "subject": "Where is my order #4471?",
        "body": (
            "Hi — I ordered the standing desk on Monday and the tracking page "
            "still says 'label created'. Can you tell me when it will actually "
            "ship? I need it before next week. Thanks!"
        ),
    },
    "refund": {
        "from_email": "bob.c@example.com",
        "subject": "Charged twice for order #5582",
        "body": (
            "I was billed $129.00 twice for the same order #5582 this morning — "
            "I can see both charges on my card. Please refund the duplicate."
        ),
    },
}


async def _main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is not set in .env — cannot call the model.")

    n = seed_customers_if_empty()
    print(f"customers table: {n} row(s) (seeded only if it had been empty)\n")

    which = sys.argv[1] if len(sys.argv) > 1 else "normal"
    email = SAMPLE_EMAILS.get(which, SAMPLE_EMAILS["normal"])
    # For the refund demo, approve the gate so you can see the tool actually run.
    decision = "approve" if which == "refund" else "reject"

    print(f"Incoming email from {email['from_email']} — {email['subject']!r}")
    print("-" * 72)
    reply = await handle_email(email, refund_decision=decision)
    print("\nDrafted reply:\n")
    print(reply)
    print("-" * 72)


if __name__ == "__main__":
    asyncio.run(_main())

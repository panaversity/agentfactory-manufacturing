"""Durable-HITL audit inspector.

The refund-approval-gate is DRIVEN through the inngest-dev MCP / dashboard, which
is the reliable way to get a run_id and watch the wait step (the dev server's REST
`/v1/events/<id>/runs` returned nothing here, but `send_event` returns the runId):

  1. send_event  customer/refund_email.received
        data {from_email, subject, body, request_id}      -> returns runId
  2. get_run_status <runId>   -> the `await-refund-decision` step shows WAITING
  3. send_event  customer/refund.decided
        data {run_id: <runId>, approved: true|false}
  4. poll_run_status [<runId>] -> COMPLETED, output.status = refunded|blocked

This script then PROVES the audit outcome. Because worked_example shares its Neon
DB with parts_1_3, Bob's lifetime totals are polluted — so always verify a single
run by its idempotency_key (refund:<customer_id>:<request_id>), never by totals.

    uv run --active python verify_hitl.py key refund:2:demo-approve-1
    uv run --active python verify_hitl.py audit bob.c@example.com
"""

import os
import sys

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()


def _conn():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def key(idem_key: str) -> None:
    """Show ONLY the rows for one refund's idempotency key — the clean per-run view."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, action, detail->>'amount' AS amount FROM audit_log "
            "WHERE detail->>'idempotency_key' = %s ORDER BY id",
            (idem_key,),
        ).fetchall()
    issued = sum(1 for r in rows if r["action"] == "refund_issued")
    blocked = sum(1 for r in rows if r["action"] == "refund_blocked")
    print(f"key={idem_key}")
    for r in rows:
        print(f"  #{r['id']} {r['action']} amount={r['amount']}")
    print(f"refund_issued={issued} refund_blocked={blocked} rows={len(rows)}")


def audit(email: str) -> None:
    """Latest audit rows + per-action counts for one customer (lifetime, polluted)."""
    with _conn() as conn:
        cust = conn.execute("SELECT id FROM customers WHERE email=%s", (email,)).fetchone()
        if not cust:
            print(f"no customer {email}")
            return
        cid = cust["id"]
        counts = conn.execute(
            "SELECT action, count(*) AS n FROM audit_log WHERE customer_id=%s "
            "GROUP BY action ORDER BY action",
            (cid,),
        ).fetchall()
    print(f"customer_id={cid}")
    for r in counts:
        print(f"  {r['action']}={r['n']}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "audit"
    if cmd == "key":
        key(sys.argv[2])
    elif cmd == "audit":
        audit(sys.argv[2] if len(sys.argv) > 2 else "bob.c@example.com")
    else:
        print(f"unknown command {cmd!r}; use: key <idem_key> | audit <email>")

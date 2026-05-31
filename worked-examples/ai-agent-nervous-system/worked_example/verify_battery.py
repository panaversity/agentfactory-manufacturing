"""One-shot verification of the durable-HITL refund gate. Writes _battery.txt.

Self-contained: drives the gate via the dev-server ingest endpoint and resolves
each run from the run_id we stamp into the refund_requested audit row — no
dashboard, no MCP. Covers:

  A. APPROVE (fresh key)         -> refund_issued=1, draft_created(approved)
  B. APPROVE AGAIN (same key)    -> refund_issued STILL 1  (boundary idempotency)
  C. REJECT (fresh key)          -> refund_blocked=1, issued=0, reply not a promise

IMPORTANT: each email is sent EXACTLY ONCE. An earlier version re-sent when it did
not detect suspension fast enough, which created a SECOND suspended run sharing one
idempotency_key and polluted per-key counts. The fix is to send once and wait
patiently for THIS request's run to appear (the model can take 10-15s), so one
request_id == one run == one decision.
"""
import json
import os
import time
import urllib.request

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()
DEV = "http://127.0.0.1:8288"
OUT: list[str] = []
EMAIL = {
    "from_email": "bob.c@example.com",
    "subject": "Charged twice for order #5582",
    "body": (
        "I was billed $129.00 twice for the same order #5582 this morning — I can "
        "see both charges on my card. Please refund the duplicate."
    ),
}


def send(name: str, data: dict) -> None:
    req = urllib.request.Request(
        DEV + "/e/dev-key",
        data=json.dumps({"name": name, "data": data}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=15).read()


def conn():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def rows_for(key: str) -> list[dict]:
    with conn() as c:
        return c.execute(
            "SELECT id, action, detail FROM audit_log "
            "WHERE detail->>'idempotency_key'=%s ORDER BY id",
            (key,),
        ).fetchall()


def request_count(key: str) -> int:
    return sum(1 for r in rows_for(key) if r["action"] == "refund_requested")


def newest_run_id(key: str) -> str | None:
    rids = [
        r["detail"].get("run_id")
        for r in rows_for(key)
        if r["action"] == "refund_requested" and r["detail"].get("run_id")
    ]
    return rids[-1] if rids else None


def drive_once(req_id: str, expect_request_no: int) -> str | None:
    """Send the refund email ONCE; wait for the Nth refund_requested row (this
    request's run) to appear and return its run_id. Never re-sends."""
    send("customer/refund_email.received", {**EMAIL, "request_id": req_id})
    key = f"refund:2:{req_id}"
    for _ in range(60):  # up to 30s — model + suspend
        if request_count(key) >= expect_request_no:
            return newest_run_id(key)
        time.sleep(0.5)
    return None


def has_terminal_after(key: str, baseline_terminal: int) -> bool:
    rows = rows_for(key)
    n = sum(1 for r in rows if r["action"] in ("refund_issued", "refund_blocked"))
    return n > baseline_terminal


def decide_and_wait(req_id: str, run_id: str, approved: bool) -> None:
    key = f"refund:2:{req_id}"
    base = sum(
        1 for r in rows_for(key) if r["action"] in ("refund_issued", "refund_blocked")
    )
    send("customer/refund.decided", {"run_id": run_id, "approved": approved})
    for _ in range(80):  # up to 40s — resume runs the model again
        if has_terminal_after(key, base):
            time.sleep(1.5)  # let the trailing audit-reply land
            return
        time.sleep(0.5)


def summarize(key: str, tag: str) -> None:
    rows = rows_for(key)
    issued = sum(1 for r in rows if r["action"] == "refund_issued")
    blocked = sum(1 for r in rows if r["action"] == "refund_blocked")
    drafts = [r for r in rows if r["action"] == "draft_created"]
    OUT.append(f"[{tag}] key={key}")
    for r in rows:
        OUT.append(f"    #{r['id']} {r['action']} dec={r['detail'].get('refund_decision','')}")
    OUT.append(f"    => refund_issued={issued} refund_blocked={blocked} draft_created={len(drafts)}")
    for d in drafts:
        txt = (d["detail"].get("draft") or "").replace("\n", " ")
        promise = any(
            p in txt.lower()
            for p in ("i've initiated", "initiated a refund", "refund of $", "on the way", "processed shortly")
        )
        OUT.append(f"    reply[{d['detail'].get('refund_decision','')}]: promises_refund?={promise} :: {txt[:120]}")


def main() -> None:
    stamp = str(int(time.time()))

    # A — approve, fresh key
    reqA = f"v2-approve-{stamp}"
    keyA = f"refund:2:{reqA}"
    ridA = drive_once(reqA, 1)
    OUT.append(f"A.run_id={ridA}")
    if ridA:
        decide_and_wait(reqA, ridA, True)
    summarize(keyA, "A approve (expect issued=1)")

    # B — approve AGAIN, SAME key (a second run for one request_id == boundary test)
    ridB = drive_once(reqA, 2)  # same req_id -> same idem key, 2nd request row
    OUT.append(f"B.run_id={ridB} (same key {keyA})")
    if ridB:
        decide_and_wait(reqA, ridB, True)
    summarize(keyA, "B approve-again (expect issued STILL 1)")

    # C — reject, fresh key
    reqC = f"v2-reject-{stamp}"
    keyC = f"refund:2:{reqC}"
    ridC = drive_once(reqC, 1)
    OUT.append(f"C.run_id={ridC}")
    if ridC:
        decide_and_wait(reqC, ridC, False)
    summarize(keyC, "C reject (expect blocked=1, issued=0, no-promise reply)")

    open("_battery.txt", "w").write("\n".join(OUT) + "\n")
    print("\n".join(OUT))


if __name__ == "__main__":
    main()

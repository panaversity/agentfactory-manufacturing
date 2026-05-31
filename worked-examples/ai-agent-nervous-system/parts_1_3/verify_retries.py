"""Compact verifier for the per-step retry/failure handling (Concept 6 ext).

Reads the host's /debug/step-executions probe (proves which step bodies actually
ran, i.e. retry counts + memoization) and cross-checks each run's final status
and output via the dev server's REST API. Prints ONE compact line per run so the
result survives the terminal's truncation of long opaque IDs.
"""

import json
import os
import urllib.request

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()

HOST = "http://127.0.0.1:8000"
DEV = "http://127.0.0.1:8288"
STEP_ORDER = [
    "load-customer",
    "load-thread",
    "draft-reply",
    "persist-draft",
    "notify-reviewer",
]


def get(url: str) -> dict:
    return json.load(urllib.request.urlopen(url, timeout=10))


def sig(counts: dict) -> str:
    return " ".join(f"{k.split('-')[0]}={counts.get(k, 0)}" for k in STEP_ORDER)


def run_status(rid: str) -> dict:
    try:
        return get(f"{DEV}/v1/runs/{rid}")["data"]
    except Exception as e:  # noqa: BLE001
        return {"status": f"ERR:{type(e).__name__}"}


probe = get(f"{HOST}/debug/step-executions")
print(f"RUN_COUNT={probe['run_count']}")
for i, (rid, info) in enumerate(probe["runs"].items()):
    d = run_status(rid)
    o = d.get("output") if isinstance(d.get("output"), dict) else {}
    if d.get("status") == "Completed":
        tail = (
            f"persisted={o.get('persisted')} degraded={o.get('degraded')} "
            f"notified={o.get('notified')} retry={o.get('retry_policy')}"
        )
    else:
        tail = f"err={str((o or {}).get('error') or d.get('output'))[:90]}"
    print(f"R{i}: status={d.get('status'):<9} | {sig(info['counts'])} | {tail}")

with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as c:
    rows = c.execute(
        """
        SELECT cu.email, count(*) AS n
        FROM audit_log a JOIN customers cu ON cu.id = a.customer_id
        WHERE a.action = 'draft_created'
        GROUP BY cu.email ORDER BY cu.email
        """
    ).fetchall()
for r in rows:
    print(f"DRAFT_CREATED {r['email']} = {int(r['n'])}")

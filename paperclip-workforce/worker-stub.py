#!/usr/bin/env python3
"""worker-stub.py: a keyless HTTP Worker for Paperclip.

This is your first Worker. It is deliberately tiny and uses no LLM and no
API key. Paperclip sends it a heartbeat (an HTTP POST) whenever an issue is
assigned to it. The stub reads the issue out of that payload and resolves it
by posting a disposition back to Paperclip (status -> done).

A real Worker would draft an actual reply here instead of acknowledging.
Later in the crash course you swap this stub for an LLM-backed Worker; the
shape of the contract (receive heartbeat, read the issue, post a disposition)
stays exactly the same.

Run it (stdlib only, no pip install):

    python3 worker-stub.py 8899 http://127.0.0.1:3100

Argument 1 is the port to listen on. Argument 2 is the Paperclip API host:
the bare host and port, with NO "/api" suffix (yours may be on a different
port). The onboard banner labels its API line ".../api" -- do not include
that suffix here; this stub appends "/api" to the routes itself, the same
way AGENTS.md tells your coding agent to keep PAPERCLIP_API_URL suffix-free.
The stub logs every heartbeat to worker-stub.log next to this file.
"""
import datetime
import http.server
import json
import os
import sys
import urllib.request

# Argument 2 is the bare Paperclip host (no "/api" suffix). We strip a
# trailing "/api" or "/" defensively, so the stub still works if someone
# passes the onboard banner's ".../api" value by mistake. API_BASE is the
# host; every route below is built as f"{API_BASE}/api/...".
_HOST = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3100").rstrip("/")
API_BASE = _HOST[: -len("/api")] if _HOST.endswith("/api") else _HOST
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker-stub.log")


def log(msg: str) -> None:
    with open(LOG, "a") as f:
        f.write(f"{datetime.datetime.now().isoformat()} {msg}\n")


def resolve_issue(issue_id: str, run_id: str) -> str | None:
    """Post a disposition back to Paperclip: mark the assigned issue done.

    In local trusted (loopback) mode no auth header is needed. The route is
    top-level: PATCH /api/issues/:id (not nested under the company). API_BASE
    is the bare host, so the "/api" prefix is added here.
    """
    url = f"{API_BASE}/api/issues/{issue_id}"
    body = json.dumps(
        {
            "status": "done",
            "comment": (
                f"Tier-1 stub Worker handled this issue (heartbeat run {run_id}). "
                "Acknowledged the customer and closed it. A real Worker would "
                "draft the actual reply here."
            ),
        }
    ).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        out = json.loads(resp.read().decode())
        log(f"  PATCH {url} -> http {resp.status}, issue status {out.get('status')}")
        return out.get("status")


class HeartbeatHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode())
        except json.JSONDecodeError:
            payload = {}

        # Paperclip's http-adapter heartbeat puts the assigned issue under
        # context. The issue id is context.issueId; the full issue (title,
        # description, status) is context.paperclipIssue.
        ctx = payload.get("context", {})
        issue_id = ctx.get("issueId")
        run_id = payload.get("runId", "unknown")
        wake_reason = ctx.get("wakeReason", "unknown")
        log(f"heartbeat: run {run_id}, wake {wake_reason}, issue {issue_id}")

        if issue_id:
            try:
                new_status = resolve_issue(issue_id, run_id)
                log(f"  resolved issue {issue_id} -> {new_status}")
            except Exception as exc:  # noqa: BLE001 - stub: log and keep serving
                log(f"  could not resolve issue {issue_id}: {exc}")

        reply = json.dumps({"status": "ok", "disposition": "done"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, fmt, *args) -> None:
        # Quiet: this stub writes its own log to worker-stub.log.
        return


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    open(LOG, "w").close()
    server = http.server.HTTPServer(("127.0.0.1", port), HeartbeatHandler)
    print(
        f"worker-stub listening on http://127.0.0.1:{port}  (Paperclip API: {API_BASE})",
        flush=True,
    )
    print("Leave this running. It logs every heartbeat to worker-stub.log.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nworker-stub stopped.", flush=True)

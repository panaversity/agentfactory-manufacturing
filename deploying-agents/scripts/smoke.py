"""Tiny smoke test: POST one message to a running harness.

Start the harness first (make run), then in another shell: make smoke
Requires OPENAI_API_KEY in your .env so the agent can actually answer.
"""

from __future__ import annotations

import json
import sys
import urllib.request

URL = "http://localhost:8000/runs"
BODY = {"message": "Hi, I cannot log in to account acct_1001.", "session_id": "smoke"}


def main() -> int:
    req = urllib.request.Request(
        URL,
        data=json.dumps(BODY).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            print(resp.read().decode("utf-8"))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"smoke failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

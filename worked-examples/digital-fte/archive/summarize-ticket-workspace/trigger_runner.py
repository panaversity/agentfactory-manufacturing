#!/usr/bin/env python3
"""Trigger eval for the REAL installed summarize-ticket skill.

Fixes two flaws in skill-creator/run_eval for our setup:
1. Passes --permission-mode acceptEdits so the nested `claude -p` can actually
   execute the Skill tool (otherwise the call is never made and nothing is
   detected -> false 0/3).
2. Tests the real installed skill (not a temp slash-command that competes with
   it), detecting a genuine `summarize-ticket` Skill invocation or a Read of its
   SKILL.md.

Reads whatever description currently sits in the skill's SKILL.md, so the
caller toggles before/after by editing that file.
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path("/Users/mjs/Downloads/digital-fte 2")
SKILL = "summarize-ticket"
MODEL = "claude-opus-4-7"
RUNS = 3
THRESHOLD = 0.5  # majority of runs


def triggered(query: str) -> bool:
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    cmd = [
        "claude", "-p", query, "--model", MODEL,
        "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
    ]
    try:
        out = subprocess.run(
            cmd, cwd=str(REPO), env=env, capture_output=True,
            text=True, timeout=120,
        ).stdout
    except subprocess.TimeoutExpired:
        return False
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "assistant":
            continue
        for c in event.get("message", {}).get("content", []):
            if c.get("type") != "tool_use":
                continue
            name = c.get("name", "")
            inp = c.get("input", {})
            if name == "Skill" and SKILL in str(inp.get("skill", "")):
                return True
            if name == "Read" and SKILL in str(inp.get("file_path", "")):
                return True
    return False


def main():
    eval_set = json.loads(Path(sys.argv[1]).read_text())
    jobs = [(item, r) for item in eval_set for r in range(RUNS)]
    rates: dict[str, list[bool]] = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        fut = {ex.submit(triggered, item["query"]): item["query"] for item, _ in jobs}
        for f in as_completed(fut):
            rates.setdefault(fut[f], []).append(f.result())

    results, passed = [], 0
    for item in eval_set:
        q = item["query"]
        trig = rates[q]
        rate = sum(trig) / len(trig)
        want = item["should_trigger"]
        ok = (rate >= THRESHOLD) if want else (rate < THRESHOLD)
        passed += ok
        results.append({"query": q, "should_trigger": want,
                        "triggers": sum(trig), "runs": len(trig), "pass": ok})
        print(f"  [{'PASS' if ok else 'FAIL'}] {sum(trig)}/{len(trig)} "
              f"want={want}: {q[:62]}", file=sys.stderr)
    print(f"Results: {passed}/{len(results)} passed", file=sys.stderr)
    print(json.dumps({"results": results,
                      "summary": {"total": len(results), "passed": passed}}, indent=2))


if __name__ == "__main__":
    main()

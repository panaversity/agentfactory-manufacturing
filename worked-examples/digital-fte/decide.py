"""decide — the out-of-band approver for parked runs (Decision 10).

Separate from the chat loop. Lists the 'awaiting' run_states rows, takes your
approve/reject on one, reloads that saved run (RunState.from_string — confirmed
against the SDK docs), and finishes it. Resuming is a LOOP: a run can come back
with approvals still pending, so we keep resuming while interruptions remain
(the Decision 9 gotcha — resume once and the refund can stay unwritten).

Usage:
  uv run python decide.py                 # list, then prompt for id + a/r
  uv run python decide.py --list          # just list awaiting rows
  uv run python decide.py <id> approve    # non-interactive
  uv run python decide.py <id> reject

The customer-data MCP server must be running (an approved refund executes through
it, just like a live turn).
"""

import asyncio
import sys

from agents import RunState, Runner
from agents.mcp import MCPServerStreamableHttp
from agents.run import RunConfig
from agents.sandbox import SandboxRunConfig
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

import chat  # triggers load_dotenv; reuse the SAME agent shape that produced the state
from audit import AuditLogger, AuditRunHooks
from run_store import ConversationBusy, RunStore

MSG_MAX = 2000


def _fmt(row) -> str:
    args = row["arguments"] or {}
    return (
        f"{row['id']}  {row['created_at']:%Y-%m-%d %H:%M}  "
        f"{row['tool_name']}({', '.join(f'{k}={v}' for k, v in args.items())})  "
        f"[session {row['session_id']}]"
    )


async def _ask(prompt: str) -> str:
    try:
        return (await asyncio.to_thread(input, prompt)).strip().lower()
    except EOFError:
        return ""


async def main() -> None:
    argv = sys.argv[1:]
    audit = AuditLogger()
    run_store = RunStore()
    await audit.start()
    await run_store.start()
    try:
        rows = await run_store.list_awaiting()
        if not rows:
            print("No awaiting runs.")
            return

        print("Awaiting approval:")
        for i, r in enumerate(rows, 1):
            print(f"  {i}. {_fmt(r)}")
        if "--list" in argv:
            return

        # Resolve which row + decision, from argv or interactively.
        chosen_id: str | None = None
        decision: str | None = None
        if len(argv) >= 2 and argv[1] in ("approve", "reject"):
            chosen_id, decision = argv[0], argv[1]
        else:
            pick = await _ask("\nEnter # (or run_states id) to decide, blank to quit: ")
            if not pick:
                return
            if pick.isdigit() and 1 <= int(pick) <= len(rows):
                chosen_id = str(rows[int(pick) - 1]["id"])
            else:
                chosen_id = pick
            ans = await _ask("[a]pprove / [r]eject: ")
            decision = "approve" if ans in ("a", "approve", "y", "yes") else "reject"

        row = await run_store.get(chosen_id)
        if row is None or row["status"] != "awaiting":
            print(f"Run {chosen_id} is not awaiting (status: "
                  f"{row['status'] if row else 'not found'}). Nothing to do.")
            return

        approve = decision == "approve"
        sid = row["session_id"]

        # Connect to the data server and rebuild the SAME agent — an approved refund
        # actually executes through the MCP server here.
        async with MCPServerStreamableHttp(
            name="customer-data",
            params={"url": chat.MCP_URL, "timeout": 30},
            cache_tools_list=True,
            client_session_timeout_seconds=30,
            max_retry_attempts=3,
            require_approval=chat.REQUIRE_APPROVAL,
        ) as cd:
            agent = chat.build_agent(mcp_servers=[cd])
            mcp_names = {t.name for t in await cd.list_tools()}
            hooks = AuditRunHooks(audit, sid, mcp_names)
            run_config = RunConfig(
                sandbox=SandboxRunConfig(client=UnixLocalSandboxClient()),
                workflow_name="decide",
            )

            # Hold the per-conversation lock so resuming can't race a live chat turn
            # on this session. Fail fast if the conversation is busy.
            try:
                async with run_store.lock(sid):
                    # Reload the paused run and apply the decision to its pending approvals.
                    state = await RunState.from_string(agent, row["state"])
                    for item in state.get_interruptions():
                        state.approve(item) if approve else state.reject(item)

                    # Flip off 'awaiting' immediately (lightweight at-most-once guard).
                    await run_store.mark(chosen_id, "approved" if approve else "rejected")
                    if not approve:
                        await audit.log(
                            "refund_blocked",
                            conversation_id=sid,
                            payload={"tool": row["tool_name"], "arguments": row["arguments"]},
                            result="rejected by human approval",
                        )

                    # Resume in a loop — keep resuming while approvals remain pending,
                    # or a single resume can return empty with the refund unwritten.
                    result = await Runner.run(agent, state, run_config=run_config, hooks=hooks)
                    while result.interruptions:
                        state = result.to_state()
                        for item in result.interruptions:
                            state.approve(item) if approve else state.reject(item)
                        result = await Runner.run(agent, state, run_config=run_config, hooks=hooks)

                    if approve:
                        await run_store.mark(chosen_id, "resumed")
                    await audit.log(
                        "message_sent",
                        conversation_id=sid,
                        payload={},
                        result=str(result.final_output)[:MSG_MAX],
                    )
                    print(f"\n[{'resumed' if approve else 'rejected'}] {result.final_output}")
            except ConversationBusy:
                print(f"[busy] conversation {sid} has an active turn — try again shortly.")
                return
    finally:
        await run_store.close()
        await audit.close()


if __name__ == "__main__":
    asyncio.run(main())

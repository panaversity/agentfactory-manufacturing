"""A terminal chat agent on the OpenAI Agents SDK local sandbox.

A SandboxAgent running on a UnixLocalSandboxClient with Capabilities.default()
PLUS the Skills capability pointed at .claude/skills, so the worker discovers and
loads our portable SKILL.md folders on demand. Conversation turns persist to Neon
Postgres through the SDK's SQLAlchemySession, so the worker remembers across turns.

Usage:
  uv run python chat.py                 # interactive loop
  uv run python chat.py "your prompt"   # one-shot; prints a trace of tool calls
                                        # so you can see a skill load
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from agents import (
    GuardrailFunctionOutput,
    InputGuardrailTripwireTriggered,
    OutputGuardrailTripwireTriggered,
    Runner,
    ToolInputGuardrailTripwireTriggered,
    ToolOutputGuardrailTripwireTriggered,
    input_guardrail,
)
from agents.extensions.memory import SQLAlchemySession
from agents.mcp import MCPServerStreamableHttp
from agents.run import RunConfig
from agents.sandbox import SandboxAgent, SandboxRunConfig

from audit import AuditLogger, AuditRunHooks
from run_store import ConversationBusy, RunStore

# The guardrail tripwires we audit and recover from (none defined yet in this
# worker, but the catch point is wired so a future guardrail trip is recorded).
GUARDRAIL_TRIPS = (
    InputGuardrailTripwireTriggered,
    OutputGuardrailTripwireTriggered,
    ToolInputGuardrailTripwireTriggered,
    ToolOutputGuardrailTripwireTriggered,
)
from agents.sandbox.capabilities import (
    Capabilities,
    LocalDirLazySkillSource,
    Skills,
)
from agents.sandbox.entries import LocalDir
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

load_dotenv()  # OPENAI_API_KEY and NEON_DATABASE_URL come from .env

# gpt-5-class: Capabilities.default() includes a filesystem capability that
# rejects smaller models with a 400 (per AGENTS.md), so stay on a gpt-5 model.
MODEL = "gpt-5"

# A stable id so the same conversation's turn history is reloaded each run. The SDK
# Session OWNS these turns (its own tables on Neon) — this is the conversational
# session, NOT the SandboxRunConfig sandbox session (per AGENTS.md, never conflate).
SESSION_ID = "terminal-chat"

# Our portable skills live here; the Skills capability stages and indexes them.
SKILLS_DIR = Path(__file__).resolve().parent / ".claude" / "skills"

# The customer-data MCP server is a SEPARATE, already-running process (streamable
# HTTP, stateless). The worker connects to it over the network — it does NOT spawn
# it — so start `uv run python server.py` in customer-data-mcp/ first. Override the
# URL with CUSTOMER_DATA_MCP_URL if you serve it elsewhere.
MCP_URL = os.environ.get("CUSTOMER_DATA_MCP_URL", "http://127.0.0.1:8000/mcp")

# Approval policy for the customer-data tools: issue_refund (moves money) needs
# human sign-off before it runs; the two read-only tools are explicitly un-gated.
REQUIRE_APPROVAL = {
    "always": {"tool_names": ["issue_refund"]},
    "never": {"tool_names": ["lookup_customer", "find_similar_resolved_tickets"]},
}


def _latest_user_text(user_input) -> str:
    """Extract just the current user turn's text.

    With a Session attached, the SDK hands the guardrail the full prepared input
    (history + new message), so screen ONLY the latest user message — otherwise a
    flagged word from a past turn would trip every later turn.
    """
    if isinstance(user_input, str):
        return user_input
    if isinstance(user_input, list):
        for item in reversed(user_input):
            if isinstance(item, dict) and item.get("role") == "user":
                content = item.get("content")
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    return " ".join(
                        p.get("text", "") for p in content if isinstance(p, dict)
                    )
        return str(user_input[-1]) if user_input else ""
    return str(user_input)


@input_guardrail
async def block_token_guardrail(context, agent, user_input) -> GuardrailFunctionOutput:
    """Trivial demo guardrail: trip on the literal token 'blockme' in the current input.

    Exists to prove the guardrail_tripped audit path end to end — a real worker
    would screen for prompt injection, PII, or out-of-scope requests here.
    """
    tripped = "blockme" in _latest_user_text(user_input).lower()
    return GuardrailFunctionOutput(
        output_info={"reason": "input contains 'blockme'"} if tripped else {},
        tripwire_triggered=tripped,
    )


def build_agent(mcp_servers: list) -> SandboxAgent[None]:
    return SandboxAgent(
        name="chat-agent",
        model=MODEL,
        instructions=(
            "You are a customer-support worker. When a request matches one of your "
            "loaded skills, use it. Use the customer-data tools for business data: "
            "lookup_customer for a customer's profile, find_similar_resolved_tickets "
            "before drafting a reply, and issue_refund (only once approved) to refund "
            "an order. Answer briefly and plainly."
        ),
        # Skills on TOP of the defaults — Capabilities.default() keeps filesystem/
        # shell/etc.; Skills adds discovery of the .claude/skills folders.
        capabilities=Capabilities.default()
        + [Skills(lazy_from=LocalDirLazySkillSource(source=LocalDir(src=SKILLS_DIR)))],
        # The runtime data boundary: the worker's only path to business data.
        mcp_servers=mcp_servers,
        # Trivial demo guardrail; a trip is caught in run_turn and audited.
        input_guardrails=[block_token_guardrail],
    )


def print_trace(result) -> None:
    """Show the agent's tool calls so a skill load is visible in the run."""
    print("\n── run trace (tool calls) ──")
    for item in result.new_items:
        raw = getattr(item, "raw_item", None)
        name = getattr(raw, "name", None)
        if name:
            args = getattr(raw, "arguments", "") or ""
            print(f"  • {type(item).__name__}: {name} {str(args)[:120]}")
    print("── end trace ──\n")


def _trip_stage(trip: Exception) -> str:
    name = type(trip).__name__
    if name.startswith("ToolInput"):
        return "tool_input"
    if name.startswith("ToolOutput"):
        return "tool_output"
    if name.startswith("Input"):
        return "input"
    return "output"


MSG_MAX = 2000  # cap stored message text so the trace stays compact


def _parse_args(arguments) -> dict:
    """Approval interruption arguments arrive as a JSON string; parse defensively."""
    if isinstance(arguments, dict):
        return arguments
    try:
        return json.loads(arguments) if arguments else {}
    except (json.JSONDecodeError, TypeError):
        return {"raw": str(arguments)}


async def prompt_approval(name: str | None, arguments) -> bool:
    """Ask the human to sign off on a gated tool call. Default (incl. EOF) is NO.

    Used by the out-of-band approver that resumes parked run_states rows (next
    step), NOT in run_turn — a turn now parks instead of blocking. Runs input() in
    a thread so the event loop keeps running and the DB pools don't go stale.
    """
    try:
        raw = await asyncio.to_thread(input, f"\n⚠ Approve {name}({arguments})? [y/N]: ")
    except EOFError:
        raw = ""
    return raw.strip().lower() in {"y", "yes"}


async def run_turn(agent, prompt, *, run_config, session, hooks, logger, run_store):
    """One turn, under a per-conversation advisory lock so two turns can't run at
    once for the same conversation (across this worker and the decide command).
    Fails fast if the conversation is busy rather than racing the Session."""
    try:
        async with run_store.lock(SESSION_ID):
            return await _do_turn(
                agent, prompt, run_config=run_config, session=session,
                hooks=hooks, logger=logger, run_store=run_store,
            )
    except ConversationBusy:
        print("agent> [busy: another turn is active for this conversation — try again]")
        return None


async def _do_turn(agent, prompt, *, run_config, session, hooks, logger, run_store):
    """Run one turn. It either FINISHES (message_sent) or PARKS: if the run comes
    back waiting on approval for a gated tool, we don't block — we serialize the
    paused run, store it as an 'awaiting' run_states row, and return, freeing the
    worker for the next turn. A guardrail trip is caught here; an out-of-band
    approver resumes parked runs later."""
    await logger.log(
        "message_received", conversation_id=SESSION_ID, payload={}, result=prompt[:MSG_MAX]
    )
    try:
        result = await Runner.run(
            agent, prompt, run_config=run_config, session=session, hooks=hooks
        )
    except GUARDRAIL_TRIPS as trip:
        # Blocked turn: message_received + guardrail_tripped, no message_sent.
        await logger.log(
            "guardrail_tripped",
            conversation_id=SESSION_ID,
            payload={"stage": _trip_stage(trip), "guardrail": type(trip).__name__},
            result="blocked",
        )
        print(f"agent> [blocked by guardrail: {type(trip).__name__}]")
        return None

    # A gated tool comes back as an interruption, not a final answer. Don't block:
    # serialize the paused run and park it as an 'awaiting' run_states row, then
    # return. One turn = one request that either finishes or parks. The out-of-band
    # approver loads 'awaiting' rows and resumes them (next step).
    if result.interruptions:
        state = result.to_state()
        intr = result.interruptions[0]
        pending = len(result.interruptions)
        run_state_id = await run_store.park(
            session_id=SESSION_ID,
            tool_name=intr.name or "unknown",
            arguments=_parse_args(intr.arguments),
            state_json=state.to_string(),
        )
        extra = f" (+{pending - 1} more pending)" if pending > 1 else ""
        print(
            f"agent> [parked: {intr.name} awaiting approval{extra} — run_states id {run_state_id}]"
        )
        return None  # parked, not finished: no message_sent for this turn

    await logger.log(
        "message_sent",
        conversation_id=SESSION_ID,
        payload={},
        result=str(result.final_output)[:MSG_MAX],
    )
    return result


async def main() -> None:
    db_url = os.environ["NEON_DATABASE_URL"]  # asyncpg form; fail loud if missing
    run_config = RunConfig(
        sandbox=SandboxRunConfig(client=UnixLocalSandboxClient()),
        workflow_name="terminal chat",
    )
    # create_tables=True lets the SDK make its own turn tables on first run.
    session = SQLAlchemySession.from_url(SESSION_ID, url=db_url, create_tables=True)

    # The audit subsystem: its OWN asyncpg pool (DATABASE_URL), separate from the
    # customer-data MCP server's pool. Ensure the conversation row exists so the
    # audit_log.conversation_id FK is satisfiable.
    audit = AuditLogger()
    await audit.start()
    await audit.ensure_conversation(SESSION_ID)

    # Durable store for paused runs (own pool). A gated tool parks here instead of
    # blocking the worker on a synchronous prompt.
    run_store = RunStore()
    await run_store.start()

    try:
        # Connect to the already-running customer-data server for the worker's lifetime.
        # Entering the context manager opens the streamable-HTTP connection; the 30s
        # session timeout covers find_similar (an embedding call + a vector query),
        # which can exceed the SDK's 5s default. cache_tools_list: the tool set is fixed.
        async with MCPServerStreamableHttp(
            name="customer-data",
            params={"url": MCP_URL, "timeout": 30},
            cache_tools_list=True,
            client_session_timeout_seconds=30,
            max_retry_attempts=3,
            require_approval=REQUIRE_APPROVAL,
        ) as customer_data:
            agent = build_agent(mcp_servers=[customer_data])

            # The set of MCP tool names the audit hooks treat as capability_invoked.
            mcp_tool_names = {t.name for t in await customer_data.list_tools()}
            hooks = AuditRunHooks(audit, SESSION_ID, mcp_tool_names)

            # One-shot mode: prompt passed on the command line.
            if len(sys.argv) > 1:
                prompt = " ".join(sys.argv[1:])
                print(f"you> {prompt}")
                result = await run_turn(
                    agent, prompt, run_config=run_config, session=session,
                    hooks=hooks, logger=audit, run_store=run_store,
                )
                if result is not None:
                    print_trace(result)
                    print(f"agent> {result.final_output}")
                return

            print("chat-agent ready. Type a message, or Ctrl-C / Ctrl-D / 'exit' to quit.\n")
            while True:
                try:
                    # input() in a thread keeps the event loop alive while we wait,
                    # so the audit + MCP connections don't go stale at the prompt.
                    user_input = (await asyncio.to_thread(input, "you> ")).strip()
                except (EOFError, KeyboardInterrupt):
                    print("\nbye")
                    break
                if user_input.lower() in {"exit", "quit"}:
                    print("bye")
                    break
                if not user_input:
                    continue

                result = await run_turn(
                    agent, user_input, run_config=run_config, session=session,
                    hooks=hooks, logger=audit, run_store=run_store,
                )
                if result is not None:
                    print(f"agent> {result.final_output}\n")
    finally:
        await run_store.close()
        await audit.close()


if __name__ == "__main__":
    asyncio.run(main())

"""Worker-side audit subsystem (Decision 7).

Observes the agent's OWN actions through the SDK run hooks and writes them to
`audit_log` / `capability_invocations` on its OWN asyncpg pool — separate from the
customer-data MCP server (which runs in another process and owns its own pool).

The MCP server's in-transaction `refund_issued` row is untouched; this adds the
observational trace AROUND it. Audit writes are best-effort but LOUD: a failed
insert prints a warning and the chat continues — it never crashes the user's turn.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict
from typing import Any

import asyncpg

from agents.lifecycle import RunHooks

# The actor recorded for every Worker-emitted row (distinct from customer_data_mcp,
# which is the actor for the in-transaction refund row).
ACTOR = "chat-agent"

# In lazy Skills mode the agent activates a skill by calling this FunctionTool.
LOAD_SKILL_TOOL = "load_skill"

_RESULT_MAX = 2000  # cap stored result text so the trace stays compact

# Errors that mean "the pooled connection died while idle" — safe to retry once,
# since the pool discards the dead connection and opens a fresh one on re-acquire.
_RETRY_ERRORS = (
    asyncpg.PostgresConnectionError,  # incl. ConnectionDoesNotExistError
    asyncpg.InterfaceError,
    OSError,
    ConnectionError,
)


class AuditLogger:
    """Owns the audit pool and the two write paths."""

    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None

    async def start(self) -> None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL not set; the audit pool cannot start.")
        # Its OWN pool — not the MCP server's. statement_cache_size=0 for Neon's pooler;
        # max_inactive_connection_lifetime recycles connections Neon may have dropped
        # while the worker sat idle at the prompt.
        self._pool = await asyncpg.create_pool(
            url,
            statement_cache_size=0,
            min_size=1,
            max_size=3,
            max_inactive_connection_lifetime=60.0,
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()

    async def _execute(self, query: str, *args) -> None:
        """Run a write, retrying once if the pooled connection was dropped while idle."""
        if self._pool is None:
            return
        last: Exception | None = None
        for _ in range(2):
            try:
                async with self._pool.acquire() as conn:
                    await conn.execute(query, *args)
                return
            except _RETRY_ERRORS as e:
                last = e  # dead connection discarded by the pool; retry gets a fresh one
        if last is not None:
            raise last

    async def ensure_conversation(self, session_id: str, user_id: str | None = None) -> None:
        """Upsert the conversation row so audit_log.conversation_id's FK is satisfiable."""
        if self._pool is None:
            return
        try:
            await self._execute(
                """
                INSERT INTO conversations (session_id, user_id)
                VALUES ($1, $2)
                ON CONFLICT (session_id) DO NOTHING
                """,
                session_id,
                user_id,
            )
        except Exception as e:  # loud, non-fatal
            _warn(f"ensure_conversation failed: {e!r}")

    async def log(
        self,
        action: str,
        *,
        conversation_id: str | None,
        payload: dict[str, Any],
        result: str | None = None,
    ) -> None:
        """Write one audit_log row (result is TEXT here)."""
        if self._pool is None:
            return
        try:
            await self._execute(
                """
                INSERT INTO audit_log (actor, action, payload, result, conversation_id)
                VALUES ($1, $2, $3::jsonb, $4, $5)
                """,
                ACTOR,
                action,
                json.dumps(payload),
                result,
                conversation_id,
            )
        except Exception as e:
            _warn(f"audit_log write ({action}) failed: {e!r}")

    async def log_capability(
        self,
        capability: str,
        *,
        conversation_id: str | None,
        status: str,
        latency_ms: int | None,
        arguments: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        """Write one capability_invocations metrics row (result is JSONB here)."""
        if self._pool is None:
            return
        try:
            await self._execute(
                """
                INSERT INTO capability_invocations
                    (conversation_id, capability, arguments, result, status, latency_ms)
                VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
                """,
                conversation_id,
                capability,
                json.dumps(arguments or {}),
                json.dumps(result) if result is not None else None,
                status,
                latency_ms,
            )
        except Exception as e:
            _warn(f"capability_invocations write ({capability}) failed: {e!r}")


class AuditRunHooks(RunHooks):
    """Maps SDK tool events to audit writes for the three in-scope points:
    skill start/end (the load_skill tool) and each MCP tool call. Default sandbox
    tools (filesystem/shell) are intentionally not audited.
    """

    def __init__(self, logger: AuditLogger, session_id: str, mcp_tool_names: set[str]) -> None:
        self._log = logger
        self._sid = session_id
        self._mcp = mcp_tool_names
        # Stack of start times per tool name (chat turns are sequential).
        self._starts: dict[str, list[float]] = defaultdict(list)

    async def on_tool_start(self, context, agent, tool) -> None:  # noqa: ANN001
        # A hook bug must never break the run — guard the whole body.
        try:
            self._starts[tool.name].append(time.perf_counter())
            if tool.name == LOAD_SKILL_TOOL:
                # skill_name is not exposed at start (no args) — captured at end.
                await self._log.log(
                    "skill_activated",
                    conversation_id=self._sid,
                    payload={"phase": "start"},
                )
        except Exception as e:
            _warn(f"on_tool_start({getattr(tool, 'name', '?')}) failed: {e!r}")

    async def on_tool_end(self, context, agent, tool, result) -> None:  # noqa: ANN001
        try:
            stack = self._starts.get(tool.name)
            latency_ms = int((time.perf_counter() - stack.pop()) * 1000) if stack else None
            result_text = _to_text(result)[:_RESULT_MAX]

            if tool.name == LOAD_SKILL_TOOL:
                skill_name, load_status = _parse_skill_result(result)
                # capability_invocations.status is the invocation OUTCOME (ok/error/
                # blocked) — NOT the skill's load status, which lives in the result.
                inv_status = "ok" if load_status in ("loaded", "already_loaded") else "error"
                await self._log.log(
                    "skill_activated",
                    conversation_id=self._sid,
                    payload={"phase": "end", "skill_name": skill_name, "latency_ms": latency_ms},
                    result=load_status,
                )
                await self._log.log_capability(
                    skill_name or "unknown_skill",
                    conversation_id=self._sid,
                    status=inv_status,
                    latency_ms=latency_ms,
                    arguments={"kind": "skill"},
                    result={"load_status": load_status, "raw": result_text},
                )
                return

            if tool.name in self._mcp:
                # The SDK reports a tool failure as an "Error executing tool …"
                # result — reflect that honestly instead of always logging "ok".
                status = "error" if "Error executing tool" in result_text else "ok"
                await self._log.log(
                    "capability_invoked",
                    conversation_id=self._sid,
                    payload={"tool": tool.name, "status": status},
                    result=result_text,
                )
                await self._log.log_capability(
                    tool.name,
                    conversation_id=self._sid,
                    status=status,
                    latency_ms=latency_ms,
                    arguments={"kind": "tool"},
                    result={"output": result_text},
                )
            # else: default sandbox tools (filesystem/shell) — out of scope, not audited.
        except Exception as e:
            _warn(f"on_tool_end({getattr(tool, 'name', '?')}) failed: {e!r}")


def _to_text(result: Any) -> str:
    """Coerce a tool result (str, dict, or Pydantic model) to text for storage."""
    if result is None:
        return ""
    if isinstance(result, str):
        return result
    return str(result)


def _parse_skill_result(result: Any) -> tuple[str | None, str | None]:
    """load_skill returns {'status':..., 'skill_name':...}; the hook may give a dict or str."""
    data: Any = result
    if isinstance(result, str):
        try:
            data = json.loads(result)
        except json.JSONDecodeError:
            return None, None
    if isinstance(data, dict):
        return data.get("skill_name"), data.get("status")
    return None, None


def _warn(msg: str) -> None:
    print(f"⚠ audit: {msg}", file=sys.stderr)

"""Durable storage for paused runs (Decision 10).

When a run comes back waiting for approval instead of with a final answer, the
worker serializes the RunState (SDK: result.to_state().to_string()) and parks it
as a run_states row marked 'awaiting', then returns. One turn is one request that
either finishes or parks. The separate `decide` command (decide.py) loads
'awaiting' rows, takes a human decision, reloads the saved run
(RunState.from_string), and finishes it.

Own asyncpg pool, mirroring the audit pool's resilience: statement_cache_size=0
for Neon's pooler, idle-connection recycling, and a one-shot retry on a dropped
connection. A jsonb codec makes `arguments` round-trip as a dict.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Awaitable, Callable

import asyncpg

_RETRY_ERRORS = (
    asyncpg.PostgresConnectionError,
    asyncpg.InterfaceError,
    OSError,
    ConnectionError,
)


class ConversationBusy(Exception):
    """Raised when another turn already holds the lock for this conversation."""

    def __init__(self, session_id: str) -> None:
        super().__init__(f"conversation {session_id!r} is busy (another turn is active)")
        self.session_id = session_id


def _advisory_key(session_id: str) -> int:
    """Stable signed 64-bit key for pg_advisory_lock (it takes a bigint)."""
    return int.from_bytes(
        hashlib.blake2b(session_id.encode(), digest_size=8).digest(), "big", signed=True
    )


def _direct_url() -> str:
    """Neon's DIRECT (non-pooled) endpoint, derived from DATABASE_URL by dropping
    '-pooler'. Advisory locks must NOT run on the pooled endpoint: PgBouncer's
    transaction pooling recycles the backend after each statement, which drops a
    session-level lock immediately. A direct connection pins one backend, so the
    lock is held for the turn and auto-released if the connection (process) dies."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set; the conversation lock needs it.")
    return url.replace("-pooler.", ".", 1)


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Decode/encode jsonb as Python dicts so `arguments` is a dict on the way out.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


class RunStore:
    """Owns the run_states pool and its reads/writes."""

    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None

    async def start(self) -> None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL not set; the run_states pool cannot start.")
        self._pool = await asyncpg.create_pool(
            url,
            init=_init_connection,
            statement_cache_size=0,
            min_size=1,
            max_size=3,
            max_inactive_connection_lifetime=60.0,
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()

    async def _run(self, op: Callable[[asyncpg.Connection], Awaitable[Any]]) -> Any:
        """Acquire a connection and run `op`, retrying once if it was dropped while idle."""
        if self._pool is None:
            raise RuntimeError("RunStore not started.")
        last: Exception | None = None
        for _ in range(2):
            try:
                async with self._pool.acquire() as conn:
                    return await op(conn)
            except _RETRY_ERRORS as e:
                last = e
        assert last is not None
        raise last

    async def park(
        self,
        *,
        session_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        state_json: str,
    ) -> str:
        """Insert one 'awaiting' row; return its id. Raises on real failure —
        parking is not best-effort, since a lost paused run is a lost action."""
        return str(
            await self._run(
                lambda conn: conn.fetchval(
                    """
                    INSERT INTO run_states (session_id, tool_name, arguments, state, status)
                    VALUES ($1, $2, $3, $4, 'awaiting')
                    RETURNING id
                    """,
                    session_id,
                    tool_name,
                    arguments,
                    state_json,
                )
            )
        )

    async def list_awaiting(self) -> list[asyncpg.Record]:
        """Pending decisions, oldest first (uses the partial 'awaiting' index)."""
        return await self._run(
            lambda conn: conn.fetch(
                """
                SELECT id, session_id, tool_name, arguments, created_at
                FROM run_states WHERE status = 'awaiting' ORDER BY created_at
                """
            )
        )

    async def get(self, run_state_id: str) -> asyncpg.Record | None:
        return await self._run(
            lambda conn: conn.fetchrow(
                "SELECT * FROM run_states WHERE id = $1", run_state_id
            )
        )

    @asynccontextmanager
    async def lock(self, session_id: str):
        """Hold a per-conversation advisory lock for the duration of a turn, so only
        one turn is active per conversation at a time (across the chat worker and the
        decide command). Session-scoped on a pinned connection: if the process dies,
        the dropped connection auto-releases the lock. Fail-fast — raises
        ConversationBusy if another turn holds it, rather than blocking."""
        key = _advisory_key(session_id)
        # Dedicated NON-pooled connection (see _direct_url): a pooled connection
        # would drop the session-level lock after the first statement.
        conn = await asyncpg.connect(_direct_url(), statement_cache_size=0)
        try:
            if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", key):
                raise ConversationBusy(session_id)
            try:
                yield
            finally:
                await conn.fetchval("SELECT pg_advisory_unlock($1)", key)
        finally:
            await conn.close()

    async def mark(self, run_state_id: str, status: str) -> None:
        """Move a row to approved/rejected/resumed, stamping the first decision time."""
        await self._run(
            lambda conn: conn.execute(
                """
                UPDATE run_states
                SET status = $2, decided_at = COALESCE(decided_at, now())
                WHERE id = $1
                """,
                run_state_id,
                status,
            )
        )


def warn(msg: str) -> None:
    print(f"⚠ run_store: {msg}", file=sys.stderr)

"""Durable state: sessions, runs, traces, artifacts, audit_log.

Two backends behind one interface:

  DATABASE_URL set -> asyncpg against Postgres (Neon)
  DATABASE_URL absent -> aiosqlite-free SQLite via the stdlib sqlite3 module

Neon footguns baked in (see normalize_neon_dsn):
  1. asyncpg does not understand `channel_binding`. Neon's copy-paste string
     includes it, so we strip it before connecting.
  2. The `-pooler` (PgBouncer) endpoint silently drops server settings like
     `search_path`. We never set search_path as a server setting; instead we
     schema-qualify every table (public.runs, public.sessions, ...).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from .settings import settings

try:  # asyncpg is optional at import time; only needed for the Postgres path.
    import asyncpg
except ImportError:  # pragma: no cover
    asyncpg = None  # type: ignore[assignment]


def normalize_neon_dsn(dsn: str) -> str:
    """Strip params asyncpg cannot parse from a Neon connection string.

    asyncpg recognizes only a fixed set of DSN params and treats unknown ones
    as server settings, which then fail against PgBouncer. `channel_binding`
    is the common offender in Neon's copy-paste string. We keep sslmode.
    """
    for token in (
        "&channel_binding=require",
        "channel_binding=require&",
        "?channel_binding=require",
        "channel_binding=require",
    ):
        dsn = dsn.replace(token, "")
    # Tidy a dangling separator left behind by the strip.
    return dsn.replace("?&", "?").rstrip("?&")


class State:
    """Persistence layer with a Postgres backend and a SQLite fallback."""

    def __init__(self) -> None:
        self._pool: Any | None = None
        self._sqlite: sqlite3.Connection | None = None

    async def connect(self) -> None:
        if settings.use_postgres:
            if asyncpg is None:
                raise RuntimeError("DATABASE_URL is set but asyncpg is not installed.")
            dsn = normalize_neon_dsn(settings.database_url or "")
            self._pool = await asyncpg.create_pool(dsn, min_size=1, max_size=5)
        else:
            self._sqlite = sqlite3.connect(settings.sqlite_path)
            self._sqlite.row_factory = sqlite3.Row
            self._ensure_sqlite_schema()

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
        if self._sqlite is not None:
            self._sqlite.close()

    # ----- sessions -----

    async def get_or_create_session(self, session_id: str) -> str:
        if self._pool is not None:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO public.sessions (id) VALUES ($1) "
                    "ON CONFLICT (id) DO NOTHING",
                    session_id,
                )
            return session_id
        assert self._sqlite is not None
        self._sqlite.execute(
            "INSERT OR IGNORE INTO sessions (id) VALUES (?)", (session_id,)
        )
        self._sqlite.commit()
        return session_id

    # ----- runs + traces -----

    async def record_run(
        self, session_id: str, message: str, reply: str, used_sandbox: bool
    ) -> str:
        run_id = str(uuid.uuid4())
        trace = json.dumps({"input": message, "output": reply})
        if self._pool is not None:
            async with self._pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "INSERT INTO public.runs "
                        "(id, session_id, input_message, output_message, used_sandbox) "
                        "VALUES ($1, $2, $3, $4, $5)",
                        run_id,
                        session_id,
                        message,
                        reply,
                        used_sandbox,
                    )
                    await conn.execute(
                        "INSERT INTO public.traces (run_id, payload) VALUES ($1, $2)",
                        run_id,
                        trace,
                    )
                    await conn.execute(
                        "INSERT INTO public.audit_log (run_id, event) VALUES ($1, $2)",
                        run_id,
                        "run_completed",
                    )
            return run_id
        assert self._sqlite is not None
        self._sqlite.execute(
            "INSERT INTO runs "
            "(id, session_id, input_message, output_message, used_sandbox) "
            "VALUES (?, ?, ?, ?, ?)",
            (run_id, session_id, message, reply, int(used_sandbox)),
        )
        self._sqlite.execute(
            "INSERT INTO traces (run_id, payload) VALUES (?, ?)", (run_id, trace)
        )
        self._sqlite.execute(
            "INSERT INTO audit_log (run_id, event) VALUES (?, ?)",
            (run_id, "run_completed"),
        )
        self._sqlite.commit()
        return run_id

    # ----- artifacts -----

    async def record_artifact(self, run_id: str, key: str, url: str) -> None:
        if self._pool is not None:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO public.artifacts (run_id, object_key, url) "
                    "VALUES ($1, $2, $3)",
                    run_id,
                    key,
                    url,
                )
            return
        assert self._sqlite is not None
        self._sqlite.execute(
            "INSERT INTO artifacts (run_id, object_key, url) VALUES (?, ?, ?)",
            (run_id, key, url),
        )
        self._sqlite.commit()

    def _ensure_sqlite_schema(self) -> None:
        """Mirror schema.sql for the local SQLite fallback."""
        assert self._sqlite is not None
        self._sqlite.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                session_id TEXT REFERENCES sessions(id),
                input_message TEXT NOT NULL,
                output_message TEXT,
                used_sandbox INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS traces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT REFERENCES runs(id),
                payload TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT REFERENCES runs(id),
                object_key TEXT NOT NULL,
                url TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT REFERENCES runs(id),
                event TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        self._sqlite.commit()

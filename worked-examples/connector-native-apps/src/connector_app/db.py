"""db.py — the two-table store, read and written by the verified `sub` ONLY (Concept 5/6).

Every function here takes `sub` as its first argument and uses it as the sole identity key.
`sub` is the subject of a token `auth.verified_claims` already proved (signature, issuer,
audience, expiry). It must come from there — never from a tool argument the model can set.
There is deliberately NO function that takes a caller-supplied user id: the type system
can't stop a bad id, so the API simply never offers a seat for one (Invariant 3).

The schema (on the Neon `dev` branch):

    users(sub PK, created_at, last_seen_at)
    user_state(sub -> users, item_id, read, bookmarked, updated_at, PK (sub, item_id))
"""

import os
from typing import Any

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()

type ItemState = dict[str, Any]  # {item_id, read, bookmarked, updated_at}
type UserState = dict[str, Any]  # {sub, items: list[ItemState]}


def _connect() -> psycopg.Connection:
    """Open a fresh connection from DATABASE_URL. Caller closes it (use `with`)."""
    url = os.environ["DATABASE_URL"]
    return psycopg.connect(url, row_factory=dict_row)


def touch_user(sub: str) -> None:
    """Ensure a `users` row exists for this verified subject; refresh last_seen_at.

    Called from begin_session right after identity is verified. `sub` is the token subject,
    not anything the model passed in.
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO users (sub) VALUES (%(sub)s)
            ON CONFLICT (sub) DO UPDATE SET last_seen_at = now()
            """,
            {"sub": sub},
        )


def get_user_state(sub: str) -> UserState:
    """Return this user's full reading state, keyed on the verified `sub`.

    A scan is scoped to one subject by construction — there is no parameter that could widen
    it to another user's rows.
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT item_id, read, bookmarked, updated_at
            FROM user_state
            WHERE sub = %(sub)s
            ORDER BY updated_at DESC
            """,
            {"sub": sub},
        )
        items: list[ItemState] = cur.fetchall()
    return {"sub": sub, "items": items}


def save_item_state(
    sub: str,
    item_id: str,
    *,
    read: bool | None = None,
    bookmarked: bool | None = None,
) -> ItemState:
    """Upsert one (sub, item_id) row, keyed on the verified `sub`. Returns the saved row.

    `read`/`bookmarked` left as None keep their current value (COALESCE), so callers can flip
    one flag without clobbering the other. Both the WHERE-equivalent key and the INSERT use
    `sub` — a tool can choose WHICH ARTICLE (item_id), never WHOSE shelf.
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_state (sub, item_id, read, bookmarked)
            VALUES (%(sub)s, %(item_id)s, COALESCE(%(read)s, false), COALESCE(%(bookmarked)s, false))
            ON CONFLICT (sub, item_id) DO UPDATE SET
                read       = COALESCE(%(read)s, user_state.read),
                bookmarked = COALESCE(%(bookmarked)s, user_state.bookmarked),
                updated_at = now()
            RETURNING item_id, read, bookmarked, updated_at
            """,
            {"sub": sub, "item_id": item_id, "read": read, "bookmarked": bookmarked},
        )
        row: ItemState = cur.fetchone()  # type: ignore[assignment]  # RETURNING always yields one row
    return row

#!/usr/bin/env python3
"""customer_data_mcp — the runtime data boundary for the customer-support Worker.

A scoped, streamable-HTTP (stateless) MCP server exposing exactly three tools and
NO general SQL surface. Every query below is fixed and parameterized; free text
only ever becomes an embedding vector, never SQL. This is the only path the
running Worker has to business data.

Schema note: built against the live `chat-agent` Neon DB (the project DATABASE_URL
points to). IDs are text; customer tier lives in customers.metadata->>'tier';
resolved-ticket documents link back via documents.metadata->>'ticket_id'.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import asyncpg
from dotenv import load_dotenv
from mcp.server.fastmcp import Context, FastMCP
from openai import AsyncOpenAI
from pgvector.asyncpg import register_vector
from pydantic import BaseModel, Field

# --- Configuration ---------------------------------------------------------

# The app's single .env lives one level up (the project root).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
EMBED_MODEL = "text-embedding-3-small"  # MUST match the model the seed used.


# --- Lifespan: one pool + one OpenAI client for the server's lifetime ------


@dataclass
class AppContext:
    """Shared resources, initialized once at startup."""

    pool: asyncpg.Pool
    openai: AsyncOpenAI


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Run on every pooled connection: teach asyncpg the pgvector type."""
    await register_vector(conn)


@asynccontextmanager
async def app_lifespan(_server: FastMCP) -> AsyncIterator[AppContext]:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set; cannot start customer_data_mcp.")
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set; semantic search would fail.")

    pool = await asyncpg.create_pool(
        DATABASE_URL,
        init=_init_connection,
        statement_cache_size=0,  # Neon's pooled endpoint (PgBouncer) needs this.
        min_size=1,
        max_size=5,
    )
    openai = AsyncOpenAI()
    try:
        yield AppContext(pool=pool, openai=openai)
    finally:
        await pool.close()


mcp = FastMCP(
    "customer_data_mcp",
    stateless_http=True,
    json_response=True,
    lifespan=app_lifespan,
    host="127.0.0.1",
    port=8000,
)


# --- Output models (structured content) ------------------------------------


class CustomerProfile(BaseModel):
    id: str
    name: str
    email: str
    tier: str
    open_ticket_count: int


class SimilarTicket(BaseModel):
    ticket_id: str
    subject: str
    resolution: str
    similarity: float = Field(description="Cosine similarity in [0,1]; higher is closer.")


class RefundResult(BaseModel):
    refund_id: str
    order_id: str
    amount_cents: int
    order_status: str


# --- Shared helpers ---------------------------------------------------------


async def _embed(openai: AsyncOpenAI, text: str) -> list[float]:
    """Embed text with the same model the seed corpus used (1536-dim)."""
    resp = await openai.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding


def _app(ctx: Context) -> AppContext:
    return ctx.request_context.lifespan_context


# --- Tools ------------------------------------------------------------------


@mcp.tool(
    name="lookup_customer",
    annotations={
        "title": "Look up a customer profile",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def lookup_customer(
    ctx: Context,
    customer_id: Annotated[
        str,
        Field(description="The customer's id, e.g. 'cust_1a2b3c'.", min_length=1, max_length=64),
    ],
) -> CustomerProfile:
    """Look up one customer's profile and current support load.

    Call this FIRST when you have a customer id and need their email, plan tier,
    or how many tickets they currently have open. This is a per-customer lookup —
    NOT semantic search (for finding precedent cases, use
    find_similar_resolved_tickets instead).

    Returns a CustomerProfile: {id, name, email, tier, open_ticket_count}.
    Raises a clear error if no customer has that id.
    """
    pool = _app(ctx).pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT c.id,
                   c.name,
                   c.email,
                   COALESCE(c.metadata->>'tier', 'standard') AS tier,
                   (SELECT count(*) FROM tickets t
                     WHERE t.customer_id = c.id
                       AND t.status NOT IN ('resolved', 'closed')) AS open_ticket_count
            FROM customers c
            WHERE c.id = $1
            """,
            customer_id,
        )
    if row is None:
        raise ValueError(f"No customer found with id '{customer_id}'. Check the id and try again.")
    return CustomerProfile(**dict(row))


@mcp.tool(
    name="find_similar_resolved_tickets",
    annotations={
        "title": "Find similar resolved tickets",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,  # calls the OpenAI embeddings API
    },
)
async def find_similar_resolved_tickets(
    ctx: Context,
    description: Annotated[
        str,
        Field(description="A free-text description of the current issue.", min_length=3, max_length=2000),
    ],
    limit: Annotated[int, Field(description="Max matches to return.", ge=1, le=20)] = 5,
) -> list[SimilarTicket]:
    """Find past RESOLVED tickets semantically similar to a problem description.

    ALWAYS call this before drafting a reply to a customer, to reuse proven
    resolutions. The description is embedded with text-embedding-3-small and
    matched by cosine distance against the resolved-ticket corpus — the text
    never touches SQL, it only becomes a vector.

    Returns up to `limit` SimilarTicket rows {ticket_id, subject, resolution,
    similarity}, closest first. Returns an empty list if the corpus is empty.
    """
    app = _app(ctx)
    query_vec = await _embed(app.openai, description)
    async with app.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT t.id AS ticket_id,
                   t.subject,
                   t.resolution,
                   1 - (e.embedding <=> $1) AS similarity
            FROM embeddings e
            JOIN documents d ON d.id = e.document_id
            JOIN tickets   t ON t.id = (d.metadata->>'ticket_id')
            WHERE t.status = 'resolved'
              AND t.resolution IS NOT NULL
            ORDER BY e.embedding <=> $1
            LIMIT $2
            """,
            query_vec,
            limit,
        )
    return [SimilarTicket(**dict(r)) for r in rows]


@mcp.tool(
    name="issue_refund",
    annotations={
        "title": "Issue a refund (writes money)",
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": False,
        "openWorldHint": False,
    },
)
async def issue_refund(
    ctx: Context,
    order_id: Annotated[str, Field(description="The order id to refund.", min_length=1, max_length=64)],
    amount_cents: Annotated[int, Field(description="Refund amount in cents (>0).", gt=0)],
    reason: Annotated[str, Field(description="Why the refund is issued.", min_length=1, max_length=500)],
    request_id: Annotated[
        str,
        Field(
            description="A stable, unique id for THIS refund request (e.g. the ticket "
            "or approval id). Reusing the same id makes the call idempotent: a retry "
            "or re-run with the same (order_id, request_id) will NOT issue a second refund.",
            min_length=1,
            max_length=128,
        ),
    ],
    conversation_id: Annotated[
        str | None,
        Field(description="Optional session id to tie this action to the audit trail."),
    ] = None,
) -> RefundResult:
    """Issue a refund against an order — atomically and idempotently.

    Only call this AFTER a refund has been approved; it moves money. In ONE
    transaction it inserts the refund row, sets the order status to 'refunded',
    and writes a 'refund_issued' audit_log entry. If anything fails, none of the
    three are written.

    Idempotent on (order_id, request_id): calling again with the same pair returns
    the original refund and writes nothing — so a retried or re-run approval cannot
    issue a second refund.

    Returns a RefundResult {refund_id, order_id, amount_cents, order_status}.
    Raises a clear error (and writes nothing) if the order is missing, already
    refunded by a DIFFERENT request, or the amount exceeds the order total.
    """
    pool = _app(ctx).pool
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Idempotency first: this exact request already ran → replay its result,
            # no second write, no error.
            prior = await conn.fetchrow(
                "SELECT id FROM refunds WHERE order_id = $1 AND request_id = $2 FOR UPDATE",
                order_id,
                request_id,
            )
            if prior is not None:
                return RefundResult(
                    refund_id=str(prior["id"]),
                    order_id=order_id,
                    amount_cents=amount_cents,
                    order_status="refunded",
                )

            order = await conn.fetchrow(
                "SELECT status, total_cents FROM orders WHERE id = $1 FOR UPDATE",
                order_id,
            )
            if order is None:
                raise ValueError(f"No order found with id '{order_id}'.")
            if order["status"] == "refunded":
                raise ValueError(f"Order '{order_id}' has already been refunded.")
            if amount_cents > order["total_cents"]:
                raise ValueError(
                    f"Refund {amount_cents}¢ exceeds order total {order['total_cents']}¢."
                )

            # ON CONFLICT guards a concurrent duplicate that slips past the check above.
            refund_id = await conn.fetchval(
                """
                INSERT INTO refunds (order_id, amount_cents, reason, status, request_id)
                VALUES ($1, $2, $3, 'issued', $4)
                ON CONFLICT (order_id, request_id) DO NOTHING
                RETURNING id
                """,
                order_id,
                amount_cents,
                reason,
                request_id,
            )
            if refund_id is None:
                prior = await conn.fetchrow(
                    "SELECT id FROM refunds WHERE order_id = $1 AND request_id = $2",
                    order_id,
                    request_id,
                )
                return RefundResult(
                    refund_id=str(prior["id"]),
                    order_id=order_id,
                    amount_cents=amount_cents,
                    order_status="refunded",
                )

            await conn.execute("UPDATE orders SET status = 'refunded' WHERE id = $1", order_id)
            await conn.execute(
                """
                INSERT INTO audit_log (actor, action, payload, result, conversation_id)
                VALUES ($1, $2, $3::jsonb, $4, $5)
                """,
                "customer_data_mcp",
                "refund_issued",
                json.dumps({
                    "order_id": order_id,
                    "amount_cents": amount_cents,
                    "reason": reason,
                    "request_id": request_id,
                }),
                str(refund_id),
                conversation_id,
            )

    return RefundResult(
        refund_id=str(refund_id),
        order_id=order_id,
        amount_cents=amount_cents,
        order_status="refunded",
    )


if __name__ == "__main__":
    mcp.run(transport="streamable-http")

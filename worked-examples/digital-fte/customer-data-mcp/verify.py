"""Throwaway end-to-end check of the three tools against the live chat-agent DB.

Drives the real tool functions (not mocks) through a hand-built Context so we
exercise the actual SQL, the pgvector codec, and the embedding model match.

SAMPLE NOTE: this is a development scratch script, not part of the Worker. It
references seed-specific ids (e.g. customer "cust_05204f7c") that exist only in
the DB this was built against — adjust them to your own seeded rows before running.
"""

import asyncio
import types

import asyncpg
from openai import AsyncOpenAI
from pgvector.asyncpg import register_vector

import server


def fake_ctx(app: server.AppContext) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        request_context=types.SimpleNamespace(lifespan_context=app)
    )


# @mcp.tool may wrap the function; unwrap to the raw callable if needed.
def raw(tool):
    return getattr(tool, "fn", tool)


async def main() -> None:
    pool = await asyncpg.create_pool(
        server.DATABASE_URL, init=server._init_connection, statement_cache_size=0,
        min_size=1, max_size=2,
    )
    app = server.AppContext(pool=pool, openai=AsyncOpenAI())
    ctx = fake_ctx(app)
    try:
        print("== lookup_customer ==")
        prof = await raw(server.lookup_customer)(ctx, customer_id="cust_05204f7c")
        print(prof.model_dump())

        print("\n== lookup_customer (missing) ==")
        try:
            await raw(server.lookup_customer)(ctx, customer_id="cust_does_not_exist")
        except ValueError as e:
            print("raised as expected:", e)

        print("\n== find_similar_resolved_tickets ==")
        matches = await raw(server.find_similar_resolved_tickets)(
            ctx, description="My blender arrived broken and I want my money back", limit=3
        )
        for m in matches:
            print(f"  [{m.similarity:.3f}] {m.ticket_id}  {m.subject[:60]}")

        print("\n== issue_refund (missing order -> should block, write nothing) ==")
        try:
            await raw(server.issue_refund)(
                ctx, order_id="order_nope", amount_cents=100, reason="test"
            )
        except ValueError as e:
            print("blocked as expected:", e)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

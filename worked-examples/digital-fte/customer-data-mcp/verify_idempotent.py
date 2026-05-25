"""Throwaway check: issue_refund is idempotent on (order_id, request_id).

SAMPLE NOTE: dev scratch script. Expects order_rej_01 in 'delivered' state; adjust
the id to a fresh refundable order before running.
"""

import asyncio
import types

import asyncpg
from openai import AsyncOpenAI

import server

raw = lambda t: getattr(t, "fn", t)  # noqa: E731
ORDER = "order_rej_01"
REQ = "REQ-IDEM-1"


async def counts(conn):
    r = await conn.fetchval("SELECT count(*) FROM refunds WHERE order_id=$1", ORDER)
    a = await conn.fetchval(
        "SELECT count(*) FROM audit_log WHERE action='refund_issued' AND payload->>'order_id'=$1",
        ORDER,
    )
    return r, a


async def main():
    pool = await asyncpg.create_pool(
        server.DATABASE_URL, init=server._init_connection, statement_cache_size=0, min_size=1, max_size=2
    )
    ctx = types.SimpleNamespace(
        request_context=types.SimpleNamespace(
            lifespan_context=server.AppContext(pool=pool, openai=AsyncOpenAI())
        )
    )
    try:
        async with pool.acquire() as c:
            before = await counts(c)
            print(f"start: refunds={before[0]} audit={before[1]}")

            print("\n== call 1 (same request_id) ==")
            r1 = await raw(server.issue_refund)(ctx, order_id=ORDER, amount_cents=4500, reason="idem test", request_id=REQ)
            print("  refund_id:", r1.refund_id)

            print("== call 2 (SAME order + request_id) — must be a no-op replay ==")
            r2 = await raw(server.issue_refund)(ctx, order_id=ORDER, amount_cents=4500, reason="idem test", request_id=REQ)
            print("  refund_id:", r2.refund_id)

            after = await counts(c)
            print(f"\nafter two calls: refunds={after[0]} audit={after[1]}")
            assert r1.refund_id == r2.refund_id, "FAIL: second call returned a different refund"
            assert after == (before[0] + 1, before[1] + 1), "FAIL: a second row was written"
            print("PASS: same (order, request_id) issued exactly one refund + one audit row")

            print("\n== call 3 (DIFFERENT request_id on a refunded order) — must be blocked ==")
            try:
                await raw(server.issue_refund)(ctx, order_id=ORDER, amount_cents=4500, reason="dup", request_id="REQ-IDEM-2")
                print("  FAIL: should have raised")
            except ValueError as e:
                after3 = await counts(c)
                print(f"  blocked: {e} | rows unchanged {after}=={after3}")
                assert after3 == after
                print("  PASS: a different request can't double-refund the same order")

        print("\nALL IDEMPOTENCY CHECKS PASSED")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

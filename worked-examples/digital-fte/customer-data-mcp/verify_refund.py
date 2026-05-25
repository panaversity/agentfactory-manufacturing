"""Verify issue_refund end-to-end against live test orders:
success path, both guard paths, and atomic rollback on mid-transaction failure.

SAMPLE NOTE: development scratch script, not part of the Worker. It expects
seed-specific orders (order_test_refund / order_test_small / order_test_rollback)
in a 'delivered' state — seed your own and adjust the ids before running.
"""

import asyncio
import types

import asyncpg
from openai import AsyncOpenAI

import server

raw = lambda tool: getattr(tool, "fn", tool)  # noqa: E731


def fake_ctx(app):
    return types.SimpleNamespace(request_context=types.SimpleNamespace(lifespan_context=app))


async def order_status(conn, oid):
    return await conn.fetchval("SELECT status FROM orders WHERE id=$1", oid)


async def counts(conn, oid):
    r = await conn.fetchval("SELECT count(*) FROM refunds WHERE order_id=$1", oid)
    a = await conn.fetchval(
        "SELECT count(*) FROM audit_log WHERE action='refund_issued' AND payload->>'order_id'=$1", oid
    )
    return r, a


async def main():
    pool = await asyncpg.create_pool(
        server.DATABASE_URL, init=server._init_connection, statement_cache_size=0, min_size=1, max_size=2
    )
    app = server.AppContext(pool=pool, openai=AsyncOpenAI())
    ctx = fake_ctx(app)
    try:
        async with pool.acquire() as c:
            print("== 1. SUCCESS PATH: refund order_test_refund (8999c) ==")
            before = await counts(c, "order_test_refund")
            res = await raw(server.issue_refund)(
                ctx, order_id="order_test_refund", amount_cents=8999,
                reason="Item arrived damaged", conversation_id="sess_verify_01",
            )
            print("  returned:", res.model_dump())
            r_after, a_after = await counts(c, "order_test_refund")
            st = await order_status(c, "order_test_refund")
            print(f"  order status -> {st} | refund rows {before[0]}->{r_after} | audit rows {before[1]}->{a_after}")
            assert st == "refunded" and r_after == before[0] + 1 and a_after == before[1] + 1
            audit = await c.fetchrow(
                "SELECT actor, action, payload, result FROM audit_log "
                "WHERE action='refund_issued' AND payload->>'order_id'='order_test_refund' "
                "ORDER BY id DESC LIMIT 1"
            )
            print("  audit row:", dict(audit))
            assert audit["result"] == res.refund_id
            print("  PASS: refund + order flip + audit row all committed together")

            print("\n== 2. GUARD: refund same order again -> blocked, no new rows ==")
            b = await counts(c, "order_test_refund")
            try:
                await raw(server.issue_refund)(ctx, order_id="order_test_refund", amount_cents=100, reason="dup")
                print("  FAIL: should have raised")
            except ValueError as e:
                a = await counts(c, "order_test_refund")
                print(f"  blocked: {e} | rows unchanged {b}=={a}")
                assert a == b
                print("  PASS")

            print("\n== 3. GUARD: amount exceeds total on order_test_small (500c) -> blocked ==")
            b = await counts(c, "order_test_small")
            try:
                await raw(server.issue_refund)(ctx, order_id="order_test_small", amount_cents=9999, reason="too big")
                print("  FAIL: should have raised")
            except ValueError as e:
                st = await order_status(c, "order_test_small")
                a = await counts(c, "order_test_small")
                print(f"  blocked: {e} | status still {st} | rows unchanged {b}=={a}")
                assert st == "delivered" and a == b
                print("  PASS")

            print("\n== 4. ATOMIC ROLLBACK: force failure after writes, before commit ==")
            b = await counts(c, "order_test_rollback")
            orig = server.json.dumps

            def boom(*a, **k):
                raise RuntimeError("injected failure after refund insert + order update")

            server.json.dumps = boom  # tool calls this when building the audit payload
            try:
                await raw(server.issue_refund)(ctx, order_id="order_test_rollback", amount_cents=7000, reason="rollback test")
                print("  FAIL: should have raised")
            except RuntimeError as e:
                print("  raised mid-transaction:", e)
            finally:
                server.json.dumps = orig
            st = await order_status(c, "order_test_rollback")
            a = await counts(c, "order_test_rollback")
            print(f"  after rollback -> order status {st} | rows {b}=={a}")
            assert st == "delivered" and a == b, "rollback failed: partial write leaked!"
            print("  PASS: refund insert AND order update both rolled back — nothing leaked")

        print("\nALL REFUND-PATH CHECKS PASSED")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

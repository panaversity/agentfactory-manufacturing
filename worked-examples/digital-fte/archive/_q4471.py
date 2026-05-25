import asyncio, asyncpg, re, json

url = None
for line in open(".env"):
    if line.startswith("DATABASE_URL"):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
url = re.sub(r"^postgresql\+asyncpg", "postgresql", url)
url = re.sub(r"[?&]sslmode=require", "", url)

TID = "4471"


def show(label, rows):
    print(f"\n=== {label} ({len(rows)}) ===")
    for r in rows:
        print(json.dumps({k: str(v) for k, v in dict(r).items()}, indent=2))


async def main():
    c = await asyncpg.connect(url, ssl="require")
    pub = {r["table_name"] for r in await c.fetch(
        "select table_name from information_schema.tables where table_schema='public'")}
    print("TABLES:", sorted(pub))

    t = await c.fetch("select * from tickets where id::text=$1 or cast(id as text)=$1", TID)
    show("ticket", t)
    if not t:
        await c.close(); return
    row = dict(t[0])
    cust_id = row.get("customer_id")

    if cust_id is not None and "customers" in pub:
        show("customer", await c.fetch("select * from customers where id=$1", cust_id))
    if cust_id is not None and "orders" in pub:
        show("orders", await c.fetch("select * from orders where customer_id=$1 order by id", cust_id))
    if "refunds" in pub:
        ord_ids = [o["id"] for o in await c.fetch("select id from orders where customer_id=$1", cust_id)] if cust_id else []
        if ord_ids:
            show("refunds", await c.fetch("select * from refunds where order_id = any($1::int[])", ord_ids))
    if "audit_log" in pub:
        try:
            show("audit_log (ticket-related)", await c.fetch(
                "select * from audit_log where details::text ilike $1 order by id", f"%{TID}%"))
        except Exception as e:
            print("audit_log query skipped:", e)
    await c.close()


asyncio.run(main())

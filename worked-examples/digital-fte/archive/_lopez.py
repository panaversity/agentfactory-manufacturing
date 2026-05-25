import asyncio, asyncpg, re, json

url = None
for line in open(".env"):
    if line.startswith("DATABASE_URL"):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
url = re.sub(r"^postgresql\+asyncpg", "postgresql", url)
url = re.sub(r"\+asyncpg", "", url)
url = re.sub(r"[?&]sslmode=require", "", url)


def show(label, rows):
    print(f"\n===== {label} ({len(rows)}) =====")
    for r in rows:
        d = dict(r)
        print(json.dumps(d, indent=2, default=str))


async def main():
    c = await asyncpg.connect(url, ssl="require")

    cust = await c.fetch(
        "select * from customers where name ilike '%lopez%' or email ilike '%lopez%'"
    )
    show("CUSTOMERS matching 'lopez'", cust)
    if not cust:
        await c.close(); return
    cids = [r["id"] for r in cust]

    orders = await c.fetch("select * from orders where customer_id = any($1::int[])"
                           if isinstance(cids[0], int) else
                           "select * from orders where customer_id = any($1)", cids)
    show("ORDERS", orders)

    tickets = await c.fetch(
        ("select * from tickets where customer_id = any($1::int[]) order by created_at"
         if isinstance(cids[0], int) else
         "select * from tickets where customer_id = any($1) order by created_at"), cids)
    show("TICKETS", tickets)

    oids = [r["id"] for r in orders]
    if oids:
        refunds = await c.fetch(
            ("select * from refunds where order_id = any($1::int[])"
             if isinstance(oids[0], int) else
             "select * from refunds where order_id = any($1)"), oids)
        show("REFUNDS", refunds)

    # audit trail for these conversations / tickets
    audit = await c.fetch(
        "select id, conversation_id, actor, action, payload, result, created_at "
        "from audit_log order by created_at desc limit 40")
    show("AUDIT_LOG (recent 40)", audit)

    await c.close()


asyncio.run(main())

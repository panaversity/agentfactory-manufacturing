import asyncio, asyncpg

env = {}
for line in open(".env"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip().strip('"').strip("'")

url = env["DATABASE_URL"].replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")


async def main():
    c = await asyncpg.connect(url)
    cols = [r["column_name"] for r in await c.fetch(
        "select column_name from information_schema.columns where table_name='tickets' order by ordinal_position")]
    print("COLUMNS:", cols)

    statuses = await c.fetch("select status, count(*) from tickets group by status order by 2 desc")
    print("STATUS COUNTS:", [(r["status"], r["count"]) for r in statuses])

    # Pull everything for open/non-resolved tickets so we can reason about priority
    rows = await c.fetch("""
        select * from tickets
        where lower(status) not in ('closed','resolved')
        order by created_at asc
    """)
    print(f"\nOPEN TICKETS: {len(rows)}\n")
    for r in rows:
        print(dict(r))
        print("-" * 80)
    await c.close()


asyncio.run(main())

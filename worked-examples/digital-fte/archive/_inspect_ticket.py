import asyncio, asyncpg, re

url = None
for line in open(".env"):
    if line.startswith("DATABASE_URL"):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
url = re.sub(r"^postgresql\+asyncpg", "postgresql", url)
url = re.sub(r"[?&]sslmode=require", "", url)


async def main():
    c = await asyncpg.connect(url, ssl="require")
    tabs = [
        r["table_name"]
        for r in await c.fetch(
            "select table_name from information_schema.tables "
            "where table_schema='public' order by 1"
        )
    ]
    print("TABLES:", tabs)

    if "tickets" in tabs:
        cols = [
            r["column_name"]
            for r in await c.fetch(
                "select column_name from information_schema.columns "
                "where table_name='tickets' order by ordinal_position"
            )
        ]
        print("TICKET COLS:", cols)
        rows = await c.fetch(
            "select * from tickets where id::text = $1 or "
            "cast(id as text) = $1", "4471"
        )
        print("TICKET 4471 ROWS:", len(rows))
        for r in rows:
            print(dict(r))

    if "refunds" in tabs:
        print("REFUNDS sample cols/rows:")
        rr = await c.fetch("select * from refunds limit 5")
        for r in rr:
            print(dict(r))

    await c.close()


asyncio.run(main())

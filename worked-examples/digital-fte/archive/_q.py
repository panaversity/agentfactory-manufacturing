import asyncio, asyncpg, re, sys

url = None
for line in open("/Users/mjs/Downloads/digital-fte 2/.env"):
    if line.startswith("DATABASE_URL"):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
url = re.sub(r"^postgresql\+asyncpg", "postgresql", url)

QUERY = sys.argv[1] if len(sys.argv) > 1 else "tables"

async def main():
    c = await asyncpg.connect(url)
    if QUERY == "tables":
        rows = await c.fetch(
            "select table_name from information_schema.tables "
            "where table_schema='public' order by 1"
        )
        print("TABLES:", [r["table_name"] for r in rows])
    else:
        rows = await c.fetch(QUERY)
        for r in rows:
            print(dict(r))
    await c.close()

asyncio.run(main())

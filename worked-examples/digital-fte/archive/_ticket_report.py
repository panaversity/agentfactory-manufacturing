import asyncio, asyncpg, os

ENV_PATH = "/Users/mjs/Downloads/digital-fte 2/.env"
env = {}
for line in open(ENV_PATH):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip().strip('"').strip("'")

url = env["DATABASE_URL"].replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")


async def main():
    c = await asyncpg.connect(url)
    cols = {r["column_name"]: r["data_type"] for r in await c.fetch(
        "select column_name, data_type from information_schema.columns where table_name='tickets'"
    )}
    if not cols:
        tabs = [r["table_name"] for r in await c.fetch(
            "select table_name from information_schema.tables where table_schema='public' order by 1")]
        print("NO 'tickets' table. public tables:", tabs)
        await c.close(); return

    print("tickets columns:", cols)
    print("total rows:", await c.fetchval("select count(*) from tickets"))

    has_cat = "category" in cols
    has_status = "status" in cols
    ts = next((x for x in ("closed_at", "resolved_at", "updated_at", "created_at") if x in cols), None)
    print("category col:", has_cat, "| status col:", has_status, "| closed-ts:", ts)

    if has_status:
        print("\nstatus values:", [dict(r) for r in await c.fetch(
            "select status, count(*) n from tickets group by status order by n desc")])

    if ts:
        rng = await c.fetchrow(f"select min({ts}) lo, max({ts}) hi from tickets")
        print(f"{ts} range:", rng["lo"], "->", rng["hi"])

    if not (has_cat and ts):
        print("\nMissing category or timestamp; cannot do the breakdown as asked.")
        await c.close(); return

    where = "where status in ('closed','resolved')" if has_status else ""
    sql = f"""
    with b as (
      select category,
        case
          when {ts} >= date_trunc('week', now()) then 'this_week'
          when {ts} >= date_trunc('week', now()) - interval '7 days'
               and {ts} < date_trunc('week', now()) then 'last_week'
        end as bucket
      from tickets {where}
    )
    select category,
      count(*) filter (where bucket='this_week') this_week,
      count(*) filter (where bucket='last_week') last_week
    from b where bucket is not null
    group by category order by category;
    """
    print(f"\n== closed tickets by category (closed = status in closed/resolved; {ts}) ==")
    rows = await c.fetch(sql)
    if not rows:
        print("(no closed tickets in this-week or last-week windows)")
    tw = lw = 0
    for r in rows:
        tw += r["this_week"]; lw += r["last_week"]
        print(f"{r['category']:>22} | this_week={r['this_week']:>3} | last_week={r['last_week']:>3}")
    print(f"{'TOTAL':>22} | this_week={tw:>3} | last_week={lw:>3}")
    await c.close()


asyncio.run(main())

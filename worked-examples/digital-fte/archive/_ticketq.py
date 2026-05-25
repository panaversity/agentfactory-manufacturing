import sys, asyncio, asyncpg

env = {}
for line in open(".env"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip().strip('"').strip("'")

url = env.get("DATABASE_URL")
if not url:
    print("NO DATABASE_URL"); sys.exit(1)
clean = url.replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")


async def main():
    c = await asyncpg.connect(clean)

    cols = {r["column_name"]: r["data_type"] for r in await c.fetch(
        "select column_name, data_type from information_schema.columns where table_name='tickets'"
    )}
    if not cols:
        tabs = [r["table_name"] for r in await c.fetch(
            "select table_name from information_schema.tables where table_schema='public' order by 1")]
        print("NO 'tickets' table. public tables:", tabs)
        await c.close(); return

    print("tickets columns:", cols)
    n = await c.fetchval("select count(*) from tickets")
    print("total ticket rows:", n)

    has_cat = "category" in cols
    # pick a closed-timestamp column if one exists
    ts = next((x for x in ("closed_at", "resolved_at", "updated_at", "created_at") if x in cols), None)
    print("category column:", has_cat, "| timestamp used:", ts)

    if ts:
        rng = await c.fetchrow(f"select min({ts}) lo, max({ts}) hi from tickets")
        print(f"{ts} range:", rng["lo"], "->", rng["hi"])

    if has_cat and ts:
        sql = f"""
        with b as (
          select category,
            case
              when {ts} >= date_trunc('week', now()) then 'this_week'
              when {ts} >= date_trunc('week', now()) - interval '7 days'
                   and {ts} < date_trunc('week', now()) then 'last_week'
            end as bucket
          from tickets
          {"where status in ('closed','resolved')" if 'status' in cols else ""}
        )
        select category,
          count(*) filter (where bucket='this_week') as this_week,
          count(*) filter (where bucket='last_week') as last_week
        from b where bucket is not null
        group by category order by category;
        """
        print("\n== closed tickets by category ==")
        rows = await c.fetch(sql)
        if not rows:
            print("(no tickets fall in this-week or last-week windows)")
        for r in rows:
            print(f"{r['category']:>20} | this_week={r['this_week']} | last_week={r['last_week']}")
    await c.close()


asyncio.run(main())

import asyncio, asyncpg

env = {}
for line in open(".env"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip().strip('"').strip("'")

url = env["DATABASE_URL"]
clean = url.replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")


async def main():
    c = await asyncpg.connect(clean)
    cols = {r["column_name"]: r["data_type"] for r in await c.fetch(
        "select column_name, data_type from information_schema.columns where table_name='tickets'")}
    print("COLUMNS:", cols)
    if not cols:
        await c.close(); return

    print("\nTOTAL:", await c.fetchval("select count(*) from tickets"))
    cw = "created_at" if "created_at" in cols else None
    if cw:
        rng = await c.fetchrow(f"select min({cw}) lo, max({cw}) hi from tickets")
        print("created_at range:", rng["lo"], "->", rng["hi"])

    # this week vs last week volume
    if cw:
        print("\n== VOLUME (created) ==")
        for r in await c.fetch(f"""
          select case
            when {cw} >= date_trunc('week', now()) then 'this_week'
            when {cw} >= date_trunc('week', now()) - interval '7 days'
                 and {cw} < date_trunc('week', now()) then 'last_week'
            else 'older' end bucket, count(*) n
          from tickets group by 1 order by 1"""):
            print(f"  {r['bucket']:>10} = {r['n']}")

    def breakdown(col):
        return f"""
          select coalesce({col}::text,'(none)') k,
            count(*) filter (where {cw} >= date_trunc('week', now())) this_week,
            count(*) filter (where {cw} >= date_trunc('week', now()) - interval '7 days'
                 and {cw} < date_trunc('week', now())) last_week
          from tickets group by 1 order by this_week desc, last_week desc"""

    for col in ("category", "status", "priority"):
        if col in cols and cw:
            print(f"\n== by {col} (this_week | last_week) ==")
            for r in await c.fetch(breakdown(col)):
                print(f"  {r['k']:>22} | {r['this_week']:>3} | {r['last_week']:>3}")

    # resolution time if we have closed/resolved timestamps
    rts = next((x for x in ("resolved_at", "closed_at") if x in cols), None)
    if rts and cw:
        print(f"\n== median resolution hrs (using {rts}) this week ==")
        v = await c.fetchval(f"""
          select percentile_cont(0.5) within group (order by extract(epoch from ({rts}-{cw}))/3600.0)
          from tickets where {rts} is not null and {rts} >= date_trunc('week', now())""")
        print("  median hrs:", round(v, 1) if v else None)
    await c.close()


asyncio.run(main())

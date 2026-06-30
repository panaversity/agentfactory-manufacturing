"""list_tools.py — a local MCP client that lists what the gateway exposes (Concept 4 proof).

Connects over the real streamable-HTTP transport to the running gateway and prints its
tools. No auth yet, so this works against the bare server. Run the gateway first:

    uv run python -m connector_app.server

then, in another shell:

    uv run python scripts/list_tools.py
"""

import asyncio

from fastmcp import Client

URL = "http://127.0.0.1:8787/mcp"


async def main() -> None:
    async with Client(URL) as client:
        await client.ping()
        tools = await client.list_tools()
        print(f"connected to {URL} — {len(tools)} tool(s):\n")
        for t in tools:
            params = list((t.inputSchema or {}).get("properties", {}).keys())
            print(f"  - {t.name}({', '.join(params)})")
            if t.description:
                print(f"      {t.description.splitlines()[0]}")


if __name__ == "__main__":
    asyncio.run(main())

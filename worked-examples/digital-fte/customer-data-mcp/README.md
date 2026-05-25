# customer_data_mcp

The **runtime data boundary** for the customer-support Worker — a scoped,
streamable-HTTP (stateless) MCP server. It exposes exactly three tools and **no
general SQL surface**. This is the only path the running Worker has to business
data; the admin Neon MCP is build-time only.

## Tools

| Tool | Job | Writes? |
|---|---|---|
| `lookup_customer(customer_id)` | Profile + open-ticket count | read-only |
| `find_similar_resolved_tickets(description, limit=5)` | pgvector search over resolved cases | read-only (calls OpenAI embeddings) |
| `issue_refund(order_id, amount_cents, reason, request_id, conversation_id?)` | refund + order update + audit row, **one transaction**, **idempotent** | destructive |

`find_similar_resolved_tickets` embeds with `text-embedding-3-small` (the model
the seed used) and matches by cosine `<=>`. The free-text description only ever
becomes a vector — it never touches SQL.

`issue_refund` is destructive (`destructiveHint: true`). **Approval gating is set
on the Worker's Agents-SDK MCP-client config (`require_approval`), not here.** It is
**idempotent on `(order_id, request_id)`**: a retry or re-run with the same pair
returns the original refund and writes nothing (a `UNIQUE (order_id, request_id)`
constraint + an idempotency-check-first in the transaction). Pass a stable
`request_id` per logical refund.

## Run

Reads `DATABASE_URL` and `OPENAI_API_KEY` from the project-root `.env` (one level
up). Both must be set or the server refuses to start.

```bash
uv run python server.py        # serves http://127.0.0.1:8000/mcp
```

Quick end-to-end check against the live DB:

```bash
uv run python verify.py
```

## Wire it into the Worker (HTTP, stateless)

Start this server first, then point the Worker at it:

```python
from agents.mcp import MCPServerStreamableHttp
server = MCPServerStreamableHttp(params={"url": "http://127.0.0.1:8000/mcp"})
# agent = SandboxAgent(..., mcp_servers=[server])
```

It does **not** use stdio — the Worker connects to an already-running process, so
the stdio-only rules in AGENTS.md (`env={**os.environ}`,
`client_session_timeout_seconds`) do not apply.

## Schema it targets

The live `chat-agent` Neon DB (what `DATABASE_URL` points to). Notable: ids are
`text`; customer tier is in `customers.metadata->>'tier'`; resolved-ticket
documents link back via `documents.metadata->>'ticket_id'`; `audit_log.result`
is text and there is no `target` column.

"""Seed the resolved-ticket corpus into Neon so the Worker can search it later.

Infrastructure (a seed step), so it talks to Postgres directly with asyncpg and
calls the OpenAI embeddings API directly — NOT through the runtime worker, the
customer-data MCP server, or the SQLAlchemy Session.

For each resolved ticket from seed/resolved_tickets.json:
  1. find-or-create the customer by email          -> customers
  2. insert a resolved ticket                       -> tickets
  3. store the case text as a document              -> documents (source='past_case',
                                                       ticket id in metadata)
  4. embed the case text with text-embedding-3-small
  5. link the embedding to the document             -> embeddings

The whole run is ONE transaction: every row plus a single audit_log row
(action='corpus_seeded') commit together or not at all — the receipt commits with
the data. Embeddings are fetched in one batch BEFORE the transaction opens, so no
network call happens mid-transaction.

Run once:  uv run python seed/seed_tickets.py
"""

import asyncio
import json
import os
import ssl
import uuid
from pathlib import Path

import asyncpg
from dotenv import load_dotenv
from openai import AsyncOpenAI
from pgvector.asyncpg import register_vector

load_dotenv()  # OPENAI_API_KEY, DATABASE_URL

EMBED_MODEL = "text-embedding-3-small"
TICKETS_PATH = Path(__file__).resolve().parent / "resolved_tickets.json"


def case_text(summary: str, resolution: str) -> str:
    """The text we store AND embed — identical on both, per the embedding contract."""
    return f"Issue: {summary}\nResolution: {resolution}"


def short_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def connect() -> asyncpg.Connection:
    # asyncpg wants the libpq DSN without sslmode/channel_binding query params;
    # Neon requires TLS, and its certs verify against the default trust store.
    dsn = os.environ["DATABASE_URL"].split("?", 1)[0]
    conn = await asyncpg.connect(dsn, ssl=ssl.create_default_context())
    await register_vector(conn)  # so a python list encodes to VECTOR(1536)
    return conn


async def main() -> None:
    tickets = json.loads(TICKETS_PATH.read_text())["tickets"]
    print(f"Loaded {len(tickets)} tickets from {TICKETS_PATH.name}")

    # 4. Embed every case text in a single batch call (order preserved).
    texts = [case_text(t["summary"], t["resolution"]) for t in tickets]
    client = AsyncOpenAI()
    resp = await client.embeddings.create(model=EMBED_MODEL, input=texts)
    vectors = [d.embedding for d in resp.data]
    assert len(vectors) == len(tickets) and len(vectors[0]) == 1536

    conn = await connect()
    try:
        prior = await conn.fetchval(
            "SELECT count(*) FROM audit_log WHERE action = 'corpus_seeded'"
        )
        if prior:
            print(f"WARNING: {prior} prior seed run(s) found — re-running will "
                  "duplicate tickets/documents (customers dedupe by email).")

        counts = {"customers": 0, "tickets": 0, "documents": 0, "embeddings": 0}
        async with conn.transaction():
            for t, vec in zip(tickets, vectors):
                email = t["customer_email"]

                # 1. find-or-create customer (DO UPDATE is a no-op to force RETURNING).
                cust_id = await conn.fetchval(
                    """
                    INSERT INTO customers (id, name, email)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                    RETURNING id
                    """,
                    short_id("cust"), email.split("@", 1)[0], email,
                )
                counts["customers"] += 1

                # 2. insert the resolved ticket.
                ticket_id = await conn.fetchval(
                    """
                    INSERT INTO tickets
                        (id, customer_id, subject, body, status, resolution, resolved_at)
                    VALUES ($1, $2, $3, $4, 'resolved', $5, now())
                    RETURNING id
                    """,
                    short_id("tkt"), cust_id, t["summary"], t["summary"], t["resolution"],
                )
                counts["tickets"] += 1

                # 3. store the case text as a past_case document, ticket id in metadata.
                body = case_text(t["summary"], t["resolution"])
                metadata = json.dumps({
                    "ticket_id": ticket_id,
                    "category": t["category"],
                    "customer_email": email,
                })
                doc_id = await conn.fetchval(
                    """
                    INSERT INTO documents (source, title, body, metadata)
                    VALUES ('past_case', $1, $2, $3::jsonb)
                    RETURNING id
                    """,
                    t["summary"], body, metadata,
                )
                counts["documents"] += 1

                # 5. link the embedding to the document (conversation_id NULL -> xor CHECK).
                await conn.execute(
                    """
                    INSERT INTO embeddings (document_id, chunk_text, embedding, model)
                    VALUES ($1, $2, $3, $4)
                    """,
                    doc_id, body, vec, EMBED_MODEL,
                )
                counts["embeddings"] += 1

            # One audit row for the whole run, committed in this same transaction.
            await conn.execute(
                """
                INSERT INTO audit_log (actor, action, payload, result)
                VALUES ('seed', 'corpus_seeded', $1::jsonb, 'ok')
                """,
                json.dumps({**counts, "model": EMBED_MODEL}),
            )
    finally:
        await conn.close()

    print("Seed committed (one transaction). Rows written:")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    print("  audit_log: 1 (action='corpus_seeded')")


if __name__ == "__main__":
    asyncio.run(main())

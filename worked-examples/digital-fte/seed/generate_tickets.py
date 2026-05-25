"""Generate a varied corpus of resolved support tickets as structured data.

Uses the OpenAI Agents SDK's structured-output path: a plain Agent with a Pydantic
`output_type`, so the model returns validated objects, not free text we'd have to
parse. This is infrastructure (a seed step), not the runtime worker — hence a plain
Agent, no sandbox.

The corpus deliberately spans four issue types (refund / login / duplicate charge /
shipping) so the later pgvector semantic search has genuinely different cases to
tell apart. Output is written as structured JSON (not CSV) to seed/resolved_tickets.json
for the embedding pipeline to consume, and printed here so you can read it.

Run:  uv run python seed/generate_tickets.py
"""

import asyncio
import json
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner

load_dotenv()  # OPENAI_API_KEY

MODEL = "gpt-5"
OUT_PATH = Path(__file__).resolve().parent / "resolved_tickets.json"

Category = Literal["refund", "login", "duplicate_charge", "shipping"]


class ResolvedTicket(BaseModel):
    """One resolved support ticket — the unit the resolved-cases corpus is built from."""

    customer_email: str = Field(description="The customer's email address.")
    category: Category = Field(description="Which of the four issue types this is.")
    summary: str = Field(description="A single-line description of the problem.")
    resolution: str = Field(description="How it was actually resolved, in 1-3 sentences.")


class TicketBatch(BaseModel):
    """A batch of resolved tickets spanning all four categories."""

    tickets: list[ResolvedTicket]


def build_generator() -> Agent:
    return Agent(
        name="ticket-corpus-generator",
        model=MODEL,
        instructions=(
            "You generate a realistic corpus of RESOLVED customer-support tickets for "
            "an e-commerce store, as structured data. Make them varied and concrete: "
            "real-sounding emails, distinct customer situations, and resolutions that "
            "describe what was actually done. Spread them evenly across the four "
            "categories so a semantic search engine has clearly different cases to tell "
            "apart — refunds, login problems, duplicate charges, and shipping issues. "
            "Within a category, vary the specifics (different root causes and fixes), so "
            "two refund tickets don't read the same. Keep each summary to one line."
        ),
        output_type=TicketBatch,
    )


async def main() -> None:
    agent = build_generator()
    result = await Runner.run(
        agent,
        "Generate at least 16 resolved tickets — about four per category "
        "(refund, login, duplicate_charge, shipping). Vary the details within each.",
    )
    batch = result.final_output_as(TicketBatch, raise_if_incorrect_type=True)

    # Sanity-check the corpus before we trust it as seed data.
    by_cat: dict[str, int] = {}
    for t in batch.tickets:
        by_cat[t.category] = by_cat.get(t.category, 0) + 1
    assert len(batch.tickets) >= 12, f"only {len(batch.tickets)} tickets generated"
    missing = {"refund", "login", "duplicate_charge", "shipping"} - by_cat.keys()
    assert not missing, f"categories with no tickets: {missing}"

    OUT_PATH.write_text(json.dumps(batch.model_dump(), indent=2))

    print(f"Generated {len(batch.tickets)} resolved tickets")
    print("By category:", dict(sorted(by_cat.items())))
    print(f"Saved structured JSON -> {OUT_PATH}\n")
    for i, t in enumerate(batch.tickets, 1):
        print(f"[{i:02d}] ({t.category}) {t.customer_email}")
        print(f"     summary:    {t.summary}")
        print(f"     resolution: {t.resolution}")


if __name__ == "__main__":
    asyncio.run(main())

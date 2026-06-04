"""Maya's Tier-1 Support agent and her two tools.

Maya answers a customer's first message: she looks up the account, then
drafts a reply. The tools are deliberately simple stand-ins so the harness
runs without any external system behind it.
"""

from __future__ import annotations

from agents import Agent, function_tool

from .settings import settings

# A tiny in-memory account table. In production this would be a CRM call.
_ACCOUNTS = {
    "acct_1001": {"name": "Ada Lovelace", "plan": "Pro", "status": "active"},
    "acct_1002": {"name": "Alan Turing", "plan": "Free", "status": "past_due"},
}


@function_tool
def lookup_account(account_id: str) -> str:
    """Look up a customer account by id and return its plan and status."""
    account = _ACCOUNTS.get(account_id)
    if account is None:
        return f"No account found for id {account_id}."
    return (
        f"Account {account_id}: {account['name']}, plan {account['plan']}, "
        f"status {account['status']}."
    )


@function_tool
def draft_reply(customer_message: str, tone: str = "friendly") -> str:
    """Draft a short support reply to a customer message in the given tone."""
    return (
        f"[{tone} draft]\n"
        f"Hi there, thanks for reaching out. About: '{customer_message}'. "
        f"Here is what I can do to help."
    )


def build_agent() -> Agent:
    """Construct Maya. Model defaults to gpt-5.4-mini (the SDK default)."""
    return Agent(
        name="Maya",
        instructions=(
            "You are Maya, a Tier-1 support agent. Be brief and kind. "
            "When a customer references an account, call lookup_account first. "
            "Then call draft_reply to compose your answer."
        ),
        model=settings.model,
        tools=[lookup_account, draft_reply],
    )

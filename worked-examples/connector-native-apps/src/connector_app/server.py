"""server.py — the one gateway (Concept 4 scaffold).

A single FastMCP app on stateless streamable HTTP. One public URL, tools grouped by
name (`domain.*`, `user.*`, `config.*`) — Invariant 1. Right now it carries only the
two pieces Concept 4 asks for, with NO auth and NO real data yet:

    - `health`          — liveness, so a client can confirm the gateway is up
    - `domain.get_item` — a STUB; returns a placeholder, not a real article (that arrives
                          in Concept 6, backed by the Neon store from Concept 5)

Everything else (OAuth wiring, begin_session, the session gate, the store) is added in
later concepts. Identity will come only from the verified token's `sub` — never from a
tool argument — so even when `domain.get_item` becomes real it will not trust input for
who is asking.
"""

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.dependencies import get_http_headers
from pydantic import AnyHttpUrl

load_dotenv()  # populate AUTH_* / RESOURCE_URL / SESSION_SIGNING_SECRET before the imports below

# These modules read env at import (auth.py: AUTH_*/RESOURCE_URL; session.py: SESSION_SIGNING_SECRET),
# so they must come after load_dotenv().
from connector_app import auth, config_store, db, session  # noqa: E402
from connector_app.auth import AUTH_ISSUER, AUTH_JWKS_URL, RESOURCE_URL  # noqa: E402

# The Part 5 live-demo switch (Invariant: never default on). AUTH_DISABLED=1 drops the whole
# OAuth layer out — no provider, no 401, no discovery doc — and begin_session uses DEV_SUB as the
# sub instead of a verified token. Every other code path is identical, so the same build proves
# out over the tunnel. This is the ONLY place the auth-off switch changes behaviour.
AUTH_DISABLED = os.environ.get("AUTH_DISABLED") == "1"
DEV_SUB = os.environ.get("DEV_SUB", "dev-user")

if AUTH_DISABLED:
    # Auth off: a no-auth remote MCP URL. An unauthenticated tools/list returns 200 (claude.ai
    # accepts no-auth connectors). Open and single-user — everyone is DEV_SUB while the tunnel is up.
    mcp: FastMCP = FastMCP("Reading Room")
else:
    # OAuth resource-server wiring (Concept 8) — built AROUND the given auth.py, NOT replacing it.
    # We pull the SAME trust parameters auth.py resolved (issuer, JWKS, audience), so the FastMCP
    # verifier and auth.verified_claims (used by begin_session in Concept 10) agree by construction.
    # JWTVerifier runs the four checks (signature / iss / aud / exp) on every request; the audience
    # is RESOURCE_URL — a token minted for another server is refused (RFC 8707). RemoteAuthProvider
    # emits the 401 that triggers the client's sign-in AND publishes the discovery document at
    # /.well-known/oauth-protected-resource (RFC 9728), advertising AUTH_ISSUER as the trusted AS.
    _token_verifier = JWTVerifier(
        jwks_uri=AUTH_JWKS_URL,
        issuer=AUTH_ISSUER,
        audience=RESOURCE_URL,
    )
    _auth = RemoteAuthProvider(
        token_verifier=_token_verifier,
        authorization_servers=[AnyHttpUrl(AUTH_ISSUER)],
        base_url=RESOURCE_URL,
    )
    mcp = FastMCP("Reading Room", auth=_auth)

# The reading-room catalog, loaded once at startup, keyed by id for O(1) lookup.
# Concept 6: this is real seed content (the Neon store holds per-user STATE, not the
# articles themselves). Path is project-root/seed/articles.json.
_SEED_PATH = Path(__file__).resolve().parents[2] / "seed" / "articles.json"
_ARTICLES: dict[str, dict[str, Any]] = {
    a["id"]: a for a in json.loads(_SEED_PATH.read_text())
}


@mcp.tool
def health() -> dict[str, str]:
    """Liveness check for the gateway. Returns a static status; takes no input."""
    return {"status": "ok", "service": "reading-room"}


# --- The session gate (Concept 10) -----------------------------------------------------------
# Every domain.*/user.* tool takes a `session` token and resolves it HERE. The token is the only
# way to obtain the reader's sub inside a tool, and ONLY begin_session can mint one — so the model
# structurally cannot reach a real tool without calling begin_session first. No session → refuse.


def _reader(session_token: str) -> str:
    """Resolve the verified sub from a session token, or refuse (fail closed — Invariant 4)."""
    try:
        return session.require_session(session_token)
    except session.SessionError as e:
        raise ToolError(
            f"{e}. The reading room needs a session: call begin_session first, then pass the "
            "session token it returns into this tool. Do not proceed without one."
        ) from e


@mcp.tool
def begin_session() -> dict[str, Any]:
    """Check the reader in — CALL THIS FIRST on any new request.

    Reads identity from the verified OAuth token (sub via the given auth.verified_claims), then
    hands back: the librarian persona, the behaviour rules (including the fail-closed rule), the
    reader's shelf from the store, and a signed session token. Every other domain.*/user.* tool
    requires that token; without a prior begin_session they refuse. Identity comes only from the
    token's `sub` — never from a tool argument (Invariant 3).
    """
    if AUTH_DISABLED:
        # Part 5 live demo only: no token to verify, so identity is the fixed DEV_SUB. Same path
        # otherwise — cross-chat memory still demos (new chat, same DEV_SUB, state carries over).
        sub = DEV_SUB
    else:
        headers = get_http_headers(include={"authorization"})  # default strips authorization; re-include it
        token = auth.bearer_from_header(headers.get("authorization"))
        sub = auth.verified_claims(token)["sub"]
    db.touch_user(sub)
    cfg = config_store.get_config()
    return {
        "session": session.new_session_token(sub),
        "persona": cfg["persona"],
        "rules": cfg["rules"],
        "shelf": db.get_user_state(sub)["items"],
        "reminder": (
            "Greet the reader as the librarian using their shelf above, then carry this session "
            "token into every other tool call."
        ),
    }


@mcp.tool(name="domain_get_item")
def domain_get_item(item_id: str, session: str) -> dict[str, Any]:
    """Fetch a reading-room article by id (e.g. "a1"). Requires the begin_session token.

    The article id selects WHICH article. The reader's identity is not an argument — the session
    token carries the verified sub. An unknown id raises, so the model is never handed invented
    content.
    """
    _reader(session)  # gate: must have begun a session
    article = _ARTICLES.get(item_id)
    if article is None:
        known = ", ".join(sorted(_ARTICLES)) or "(none)"
        raise ToolError(f"no article with id {item_id!r}. Known ids: {known}")
    return {"article": article, "reminder": config_store.PRESENTATION_REMINDER}


@mcp.tool(name="user_set_bookmark")
def user_set_bookmark(item_id: str, on: bool, session: str) -> dict[str, Any]:
    """Bookmark (on=true) or remove the bookmark (on=false) on an article for the signed-in reader.

    Requires the begin_session token. The shelf is keyed on the verified sub behind that token —
    the model chooses WHICH article, never WHOSE shelf (Invariant 3).
    """
    sub = _reader(session)
    if item_id not in _ARTICLES:
        known = ", ".join(sorted(_ARTICLES)) or "(none)"
        raise ToolError(f"no article with id {item_id!r}. Known ids: {known}")
    saved = db.save_item_state(sub, item_id, bookmarked=on)
    return {"saved": saved, "reminder": config_store.PRESENTATION_REMINDER}


@mcp.tool(name="config_get_rules")
def config_get_rules() -> dict[str, Any]:
    """Re-fetch the librarian persona and behaviour rules (including the fail-closed rule).

    Deliberately NOT session-gated: these are app config, not user data, and the model may need
    them precisely when something has failed and it must know how to fail closed.
    """
    cfg = config_store.get_config()
    return {
        "persona": cfg["persona"],
        "rules": cfg["rules"],
        "reminder": config_store.PRESENTATION_REMINDER,
    }


if __name__ == "__main__":
    # Stateless streamable HTTP: each request gets a fresh transport context (no session
    # affinity) — the right default for a remote connector behind a load balancer.
    # Port 8000 to match RESOURCE_URL in .env — the token audience must equal the gateway's
    # own URL, so keep these two in lockstep once auth arrives in Concept 8.
    mcp.run(transport="http", host="127.0.0.1", port=8000, stateless_http=True)

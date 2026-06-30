"""session.py — the session token that gates every real tool (Concept 10).

begin_session() mints one of these after reading identity from the OAuth token. Every
domain.*/user.* tool then requires it. The model can't reach the real tools without first
going through the front door — which is how we make it call begin_session first.

This is a short-lived signed token (HS256) carrying the verified `sub`. It is NOT the OAuth
token; it's an internal pass that proves "this call came after a real begin_session".

Like auth.py, this ships complete: it is the gate the rest of your build relies on. Read it.
"""

import os
import time
from typing import Any

from jose import jwt
from jose.exceptions import JWTError

_SECRET: str = os.environ["SESSION_SIGNING_SECRET"]
_TTL_SECONDS = 30 * 60  # 30 minutes


class SessionError(Exception):
    """Raised when a session token is missing, expired, or invalid. Caller fails closed."""


def new_session_token(sub: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": sub, "iat": now, "exp": now + _TTL_SECONDS, "scope": "session"},
        _SECRET,
        algorithm="HS256",
    )


def require_session(token: str | None) -> str:
    """Return the sub if the session token is valid; raise SessionError otherwise."""
    if not token:
        raise SessionError("no session — call begin_session first")
    try:
        claims: dict[str, Any] = jwt.decode(token, _SECRET, algorithms=["HS256"])
    except JWTError as e:
        raise SessionError(f"invalid session: {e}") from e
    if claims.get("scope") != "session":
        raise SessionError("wrong token type")
    return claims["sub"]

"""auth.py — the OAuth token check. THE ONE FILE TO READ LINE BY LINE (Concept 8).

This server is an OAuth 2.1 *resource server* only: it never sees a password and never
issues a token. It receives a token an external authorization server (Clerk / Auth0 / Stytch,
or the local mock for the Beginner track) already issued, and proves four things before
trusting the `sub` inside it:

    1. signature  — the token was signed by that authorization server (verified via its JWKS)
    2. issuer     — `iss` is the authorization server we trust
    3. audience   — `aud` is THIS server (RFC 8707); a token minted for another server is refused
    4. expiry     — `exp` has not passed

Only after all four does it return the claims. `claims["sub"]` is the user's verified id —
the one safe source of identity. Nothing here ever comes from the model or a tool argument.

You READ this file; you do not regenerate it. An agent will happily write authorization code
that looks right and is quietly wrong, so this one ships complete: it is the standard you
check the rest of your build against.
"""

import os
import time
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError

type JWKSDoc = dict[str, Any]  # the authorization server's published key set
type Claims = dict[str, Any]  # a validated token payload; claims["sub"] is the user

AUTH_ISSUER: str = os.environ["AUTH_ISSUER"]  # e.g. https://auth.myapp.com
AUTH_JWKS_URL: str = os.environ["AUTH_JWKS_URL"]  # e.g. https://auth.myapp.com/jwks.json
RESOURCE_URL: str = os.environ["RESOURCE_URL"]  # THIS server's canonical URL — the audience


class AuthError(Exception):
    """Raised when a token fails any of the four checks. Callers map this to HTTP 401."""


# --- JWKS (the authorization server's public keys), fetched and cached briefly ----------
_JWKS_TTL_SECONDS = 600  # re-fetch every 10 min so key rotation is picked up
_jwks_cache: JWKSDoc | None = None
_jwks_fetched_at: float = 0.0


def _get_jwks() -> JWKSDoc:
    global _jwks_cache, _jwks_fetched_at
    now = time.time()
    if _jwks_cache is None or now - _jwks_fetched_at > _JWKS_TTL_SECONDS:
        resp = httpx.get(AUTH_JWKS_URL, timeout=10.0)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = now
    return _jwks_cache


def _key_for(token: str) -> dict[str, Any]:
    """Pick the JWKS key whose `kid` matches the token header. Refuse if none matches."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as e:
        raise AuthError(f"malformed token header: {e}") from e
    kid = header.get("kid")
    for key in _get_jwks().get("keys", []):
        if key.get("kid") == kid:
            return key
    raise AuthError("no signing key matches the token's kid")


def verified_claims(token: str) -> Claims:
    """Validate the token and return its claims. Raises AuthError on any failure.

    `claims["sub"]` is the user. Use it as the database key — never an id from a tool argument.
    """
    if not token:
        raise AuthError("missing token")
    key = _key_for(token)
    try:
        claims: Claims = jwt.decode(
            token,
            key,  # the matching JWKS public key
            algorithms=["RS256"],  # the AS signs with RS256
            audience=RESOURCE_URL,  # (3) MUST be this server — RFC 8707. Do NOT omit.
            issuer=AUTH_ISSUER,  # (2) the AS we trust
            options={"require": ["exp", "sub", "aud", "iss"]},  # (4) expiry + the claims we rely on
        )
    except JWTError as e:  # (1) signature, plus any of 2-4 failing
        raise AuthError(f"token rejected: {e}") from e
    return claims


def bearer_from_header(authorization_header: str | None) -> str:
    """Pull the raw token out of an `Authorization: Bearer <token>` header."""
    if not authorization_header or not authorization_header.lower().startswith("bearer "):
        raise AuthError("expected an Authorization: Bearer <token> header")
    return authorization_header.split(" ", 1)[1].strip()


def protected_resource_metadata() -> dict[str, Any]:
    """The discovery note published at /.well-known/oauth-protected-resource (RFC 9728).

    Wire this as a route on the HTTP app you build in Concept 8.
    """
    return {
        "resource": RESOURCE_URL,
        "authorization_servers": [AUTH_ISSUER],
    }

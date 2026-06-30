"""mock_auth/server.py — a LOCAL, DEV-ONLY sign-in service for the Beginner track.

It is NOT a production authorization server. It exists so you can exercise the exact
`auth.py` token-check path on your laptop without renting Clerk/Auth0/Stytch yet: it
generates an RSA keypair, serves the JWKS and a discovery document, and issues real RS256
tokens with the right `iss` and `aud`. The Standard track replaces this with a hosted AS.

What it deliberately SKIPS (because a real AS does it): the interactive login UI, the full
PKCE authorize->code->token dance, consent, refresh tokens. You get a valid token so you can
test verification; you do not get a real login flow. Never deploy this.

Run it:
    uv sync --extra mock-auth
    uv run python -m mock_auth.server          # serves on http://localhost:9000

Point your .env at it:
    AUTH_ISSUER=http://localhost:9000
    AUTH_JWKS_URL=http://localhost:9000/jwks.json
    RESOURCE_URL=http://localhost:8000         # must match your gateway's audience

Get a test token to call your gateway with:
    curl "http://localhost:9000/token?sub=test-user-001&aud=http://localhost:8000"
"""

import time
from typing import Any

import uvicorn
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Query
from jose import jwt
from jose.utils import long_to_base64

ISSUER = "http://localhost:9000"
KID = "mock-key-1"

# One ephemeral keypair per run. Restarting rotates it (auth.py re-fetches JWKS, so that's fine).
_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_numbers = _private_key.public_key().public_numbers()

app = FastAPI(title="mock-auth (DEV ONLY)")


def _private_pem() -> str:
    return _private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


@app.get("/.well-known/oauth-authorization-server")
def discovery() -> dict[str, Any]:
    return {
        "issuer": ISSUER,
        "jwks_uri": f"{ISSUER}/jwks.json",
        "token_endpoint": f"{ISSUER}/token",
        "code_challenge_methods_supported": ["S256"],  # the real AS enforces PKCE S256
    }


@app.get("/jwks.json")
def jwks() -> dict[str, Any]:
    return {
        "keys": [
            {
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": KID,
                "n": long_to_base64(_public_numbers.n).decode(),
                "e": long_to_base64(_public_numbers.e).decode(),
            }
        ]
    }


@app.get("/token")
def token(
    sub: str = Query("test-user-001", description="the user id the token will carry"),
    aud: str = Query(..., description="your gateway's RESOURCE_URL (the audience)"),
) -> dict[str, Any]:
    """Issue a valid RS256 token for local testing. A real AS issues this after a real login."""
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "sub": sub,
        "aud": aud,  # audience-bound to your gateway (RFC 8707)
        "iat": now,
        "exp": now + 3600,
        "email": f"{sub}@example.test",
    }
    access_token = jwt.encode(claims, _private_pem(), algorithm="RS256", headers={"kid": KID})
    return {"access_token": access_token, "token_type": "Bearer", "expires_in": 3600}


if __name__ == "__main__":
    print("mock-auth (DEV ONLY) on", ISSUER)
    uvicorn.run(app, host="127.0.0.1", port=9000)

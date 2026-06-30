# mock_auth — local sign-in service (DEV ONLY)

For the **Beginner track**. Lets you test the real `auth.py` token check on your laptop with
no account anywhere. It is not a production authorization server and must never be deployed —
it issues tokens with no login. The **Standard track** replaces it with a hosted AS
(Clerk / Auth0 / Stytch).

```bash
uv sync --extra mock-auth
uv run python -m mock_auth.server          # http://localhost:9000
```

In `.env`:

```
AUTH_ISSUER=http://localhost:9000
AUTH_JWKS_URL=http://localhost:9000/jwks.json
RESOURCE_URL=http://localhost:8000
```

Mint a token to call your gateway:

```bash
curl "http://localhost:9000/token?sub=test-user-001&aud=http://localhost:8000"
```

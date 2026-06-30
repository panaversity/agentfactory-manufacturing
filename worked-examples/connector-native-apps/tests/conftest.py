import os

# auth.py and session.py read these at import time; set safe dummies so the suite runs offline.
os.environ.setdefault("AUTH_ISSUER", "http://localhost:9000")
os.environ.setdefault("AUTH_JWKS_URL", "http://localhost:9000/jwks.json")
os.environ.setdefault("RESOURCE_URL", "http://localhost:8000")
os.environ.setdefault("SESSION_SIGNING_SECRET", "test-secret")

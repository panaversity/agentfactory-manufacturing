# Maya's Tier-1 Support harness.
.PHONY: install run smoke schema
# Install dependencies into a local .venv.
install:
	uv sync

# Run the harness with hot reload on http://localhost:8000
run:
	uv run uvicorn maya_harness.main:app --reload --port 8000

# POST one message to the running harness (start `make run` first).
smoke:
	uv run python scripts/smoke.py

# Apply the Postgres schema. Set DATABASE_URL to your Neon connection string.
# Use the direct (non-pooler) endpoint for DDL.
schema:
	psql "$(DATABASE_URL)" -f schema.sql


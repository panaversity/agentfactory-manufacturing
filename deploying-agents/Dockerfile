# Maya's Tier-1 Support harness. Slim Python base, uv for install.
FROM python:3.12-slim

# uv: fast, reproducible installs from the lockfile.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install deps first (cached layer) before copying the source.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Now copy the source and install the project itself.
COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Azure Container Apps terminates TLS at its managed ingress, so the app
# serves plain HTTP and trusts the forwarded headers.
CMD ["uvicorn", "maya_harness.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

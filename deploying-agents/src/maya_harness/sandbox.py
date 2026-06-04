"""Sandbox factory: pick the code-execution backend from the environment.

Cloudflare is the course's primary backend, but its Containers need a paid
Workers plan. E2B has a free Hobby tier and a first-class client in the SDK,
so it is the testable default here.

  E2B_API_KEY set            -> E2B (free tier, recommended for testing)
  CLOUDFLARE_WORKER_URL set  -> Cloudflare (course primary)
  neither                    -> None (sandbox disabled; the agent still runs)

Each backend pairs a client with its own options class. The SDK then runs
the agent inside the sandbox via RunConfig(sandbox=SandboxRunConfig(...)).
The client classes live under agents.extensions.sandbox.* and each one needs
its own SDK extra: openai-agents[e2b] for E2B, openai-agents[cloudflare] for
Cloudflare. Imports are deferred so this module loads even when an extra is
missing.
"""

from __future__ import annotations

from typing import Any

from .settings import settings


def build_sandbox_run_config() -> Any | None:
    """Return a configured SandboxRunConfig, or None when none is set up."""
    from agents.sandbox import SandboxRunConfig

    if settings.e2b_api_key:
        from agents.extensions.sandbox.e2b import (
            E2BSandboxClient,
            E2BSandboxClientOptions,
        )

        # The E2B client reads E2B_API_KEY from the environment.
        return SandboxRunConfig(
            client=E2BSandboxClient(),
            options=E2BSandboxClientOptions(sandbox_type="e2b"),
        )

    if settings.cloudflare_worker_url:
        from agents.extensions.sandbox.cloudflare import (
            CloudflareSandboxClient,
            CloudflareSandboxClientOptions,
        )

        return SandboxRunConfig(
            client=CloudflareSandboxClient(),
            options=CloudflareSandboxClientOptions(
                worker_url=settings.cloudflare_worker_url
            ),
        )

    return None

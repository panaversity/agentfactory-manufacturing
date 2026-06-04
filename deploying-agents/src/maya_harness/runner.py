"""Run Maya's agent loop, with an optional sandbox attached.

When a sandbox is configured (E2B or Cloudflare), the agent runs inside it
via RunConfig(sandbox=SandboxRunConfig(...)). When no sandbox is set up, the
agent runs normally with no code-execution boundary.

The sandbox is attached through RunConfig, not as a Runner.run kwarg: there
is no Runner.run(..., sandbox=...) parameter in the SDK.
"""

from __future__ import annotations

from dataclasses import dataclass

from agents import Agent, Runner
from agents.run import RunConfig

from .sandbox import build_sandbox_run_config


@dataclass
class RunOutput:
    reply: str
    used_sandbox: bool


async def run_agent(agent: Agent, message: str) -> RunOutput:
    """Run one turn of the agent loop and return the final reply."""
    sandbox = build_sandbox_run_config()
    run_config = RunConfig(sandbox=sandbox) if sandbox is not None else RunConfig()

    result = await Runner.run(agent, message, run_config=run_config)
    return RunOutput(
        reply=str(result.final_output),
        used_sandbox=sandbox is not None,
    )

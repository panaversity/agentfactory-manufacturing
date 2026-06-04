"""FastAPI harness for Maya. Boot with: uvicorn maya_harness.main:app

  GET  /health  -> liveness plus which capabilities are active
  POST /runs     -> run Maya for one customer message and persist the result

The app imports with only OPENAI_API_KEY set (or even without it: the import
must not fail, so the page's reader can boot the harness before adding keys).
The agent loop itself needs a real key at request time.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .agent import build_agent
from .runner import run_agent
from .settings import settings
from .state import State
from .storage import Storage

state = State()
storage = Storage()
agent = build_agent()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await state.connect()
    yield
    await state.close()


app = FastAPI(title="Maya Tier-1 Support Harness", lifespan=lifespan)


class RunRequest(BaseModel):
    message: str
    session_id: str = "default"
    save_artifact: bool = False


class RunResponse(BaseModel):
    run_id: str
    reply: str
    used_sandbox: bool
    artifact_url: str | None = None


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "model": settings.model,
        "backends": {
            "postgres": settings.use_postgres,
            "sandbox": settings.sandbox_enabled,
            "r2": settings.use_r2,
        },
    }


@app.post("/runs", response_model=RunResponse)
async def create_run(req: RunRequest) -> RunResponse:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not set. Add it to .env to run the agent.",
        )

    session_id = await state.get_or_create_session(req.session_id)
    output = await run_agent(agent, req.message)
    run_id = await state.record_run(
        session_id, req.message, output.reply, output.used_sandbox
    )

    artifact_url: str | None = None
    if req.save_artifact:
        key = f"replies/{run_id}.txt"
        artifact_url = storage.put(key, output.reply.encode("utf-8"))
        await state.record_artifact(run_id, key, artifact_url)

    return RunResponse(
        run_id=run_id,
        reply=output.reply,
        used_sandbox=output.used_sandbox,
        artifact_url=artifact_url,
    )

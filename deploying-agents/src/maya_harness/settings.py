"""Environment-driven config with graceful degradation.

The harness boots with only OPENAI_API_KEY set. Every other piece of
infrastructure falls back to a local default when its env vars are absent:

  no DATABASE_URL  -> SQLite file (./maya.db)
  no R2 creds      -> local ./artifacts directory
  no sandbox key   -> sandbox disabled (the agent still runs, just no
                      code-execution boundary)
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # Model / agent loop
    openai_api_key: str | None
    model: str

    # Durable state
    database_url: str | None  # None -> SQLite fallback
    sqlite_path: str

    # Sandbox (code execution)
    e2b_api_key: str | None
    cloudflare_worker_url: str | None

    # Artifact storage (R2 / S3-compatible)
    r2_account_id: str | None
    r2_access_key_id: str | None
    r2_secret_access_key: str | None
    r2_bucket: str | None
    local_artifact_dir: str

    @property
    def use_postgres(self) -> bool:
        return bool(self.database_url)

    @property
    def sandbox_enabled(self) -> bool:
        return bool(self.e2b_api_key or self.cloudflare_worker_url)

    @property
    def use_r2(self) -> bool:
        return bool(
            self.r2_account_id
            and self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_bucket
        )


def load_settings() -> Settings:
    return Settings(
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        model=os.getenv("MAYA_MODEL", "gpt-5.4-mini"),
        database_url=os.getenv("DATABASE_URL"),
        sqlite_path=os.getenv("SQLITE_PATH", "maya.db"),
        e2b_api_key=os.getenv("E2B_API_KEY"),
        cloudflare_worker_url=os.getenv("CLOUDFLARE_WORKER_URL"),
        r2_account_id=os.getenv("R2_ACCOUNT_ID"),
        r2_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        r2_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
        r2_bucket=os.getenv("R2_BUCKET"),
        local_artifact_dir=os.getenv("LOCAL_ARTIFACT_DIR", "artifacts"),
    )


settings = load_settings()

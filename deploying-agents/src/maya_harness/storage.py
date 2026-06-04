"""Artifact storage: Cloudflare R2 over the S3 API, or a local directory.

  R2 creds set     -> boto3 client pointed at the R2 endpoint; returns a
                      presigned URL the customer can use to download.
  R2 creds absent  -> write the bytes to ./artifacts and return a file path.

R2 speaks the S3 API, so boto3 works once you point it at the account
endpoint: https://<account_id>.r2.cloudflarestorage.com
"""

from __future__ import annotations

from pathlib import Path

from .settings import settings


class Storage:
    """Store artifact bytes and return a URL or local path."""

    def __init__(self) -> None:
        self._client = None
        if settings.use_r2:
            import boto3

            self._client = boto3.client(
                "s3",
                endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                region_name="auto",
            )

    def put(self, key: str, data: bytes, expires_in: int = 3600) -> str:
        """Store data under key. Return a presigned URL (R2) or a path (local)."""
        if self._client is not None:
            self._client.put_object(
                Bucket=settings.r2_bucket, Key=key, Body=data
            )
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.r2_bucket, "Key": key},
                ExpiresIn=expires_in,
            )

        out_dir = Path(settings.local_artifact_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return str(path)

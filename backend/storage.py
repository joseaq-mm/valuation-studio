"""Blob storage for KPI PDFs, exports, shares, feedback screenshots.

Backends (auto-selected):
  • Cloudflare R2 — when R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY
    + R2_BUCKET are set (S3-compatible API via boto3).
  • Local disk — `.local/blobs/` (or STORAGE_DIR) when R2 is not configured.

Mongo collections (`kpi_files`, `exports`, …) hold metadata; bytes live here.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

APP_NAME = "valuation-studio"
_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_DIR = _ROOT / ".local" / "blobs"

MIME_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "webp": "image/webp", "gif": "image/gif",
}

_s3_client = None
_r2_bucket: Optional[str] = None


def _as_bytes(data) -> bytes:
    if isinstance(data, bytes):
        return data
    if isinstance(data, bytearray):
        return bytes(data)
    if isinstance(data, str):
        return data.encode("utf-8")
    if data is None:
        return b""
    return bytes(data)


def _validate_key(path: str) -> str:
    rel = Path(path)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"invalid storage path: {path}")
    return path.replace("\\", "/")


def _backend() -> str:
    forced = (os.environ.get("STORAGE_BACKEND") or "").strip().lower()
    if forced in ("local", "r2"):
        return forced
    if all((os.environ.get(k) or "").strip() for k in (
        "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET",
    )):
        return "r2"
    return "local"


# ---------------------- Local disk ----------------------

def _blobs_dir() -> Path:
    raw = (os.environ.get("STORAGE_DIR") or "").strip()
    return Path(raw).expanduser() if raw else _DEFAULT_DIR


def _safe_file(path: str) -> Path:
    key = _validate_key(path)
    base = _blobs_dir().resolve()
    target = (base / key).resolve()
    if not str(target).startswith(str(base) + os.sep) and target != base:
        raise ValueError(f"invalid storage path: {path}")
    return target


def _ctype_file(target: Path) -> Path:
    return target.with_name(target.name + ".ctype")


def _init_local() -> str:
    d = _blobs_dir()
    d.mkdir(parents=True, exist_ok=True)
    return str(d.resolve())


def _put_local(path: str, data: bytes, content_type: str) -> dict:
    target = _safe_file(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(_as_bytes(data))
    _ctype_file(target).write_text(content_type or "application/octet-stream", encoding="utf-8")
    return {"path": path}


def _get_local(path: str) -> Tuple[bytes, str]:
    target = _safe_file(path)
    if not target.is_file():
        raise FileNotFoundError(path)
    payload = target.read_bytes()
    sidecar = _ctype_file(target)
    if sidecar.is_file():
        ctype = sidecar.read_text(encoding="utf-8").strip() or "application/octet-stream"
    else:
        ext = target.suffix.lstrip(".").lower()
        ctype = MIME_TYPES.get(ext, "application/octet-stream")
    return payload, ctype


# ---------------------- Cloudflare R2 (S3 API) ----------------------

def _r2_endpoint() -> str:
    account = (os.environ.get("R2_ACCOUNT_ID") or "").strip()
    custom = (os.environ.get("R2_ENDPOINT") or "").strip().rstrip("/")
    if custom:
        return custom
    return f"https://{account}.r2.cloudflarestorage.com"


def _get_s3():
    global _s3_client, _r2_bucket
    if _s3_client is not None:
        return _s3_client
    import boto3
    from botocore.config import Config

    _r2_bucket = (os.environ.get("R2_BUCKET") or "").strip()
    _s3_client = boto3.client(
        "s3",
        endpoint_url=_r2_endpoint(),
        aws_access_key_id=(os.environ.get("R2_ACCESS_KEY_ID") or "").strip(),
        aws_secret_access_key=(os.environ.get("R2_SECRET_ACCESS_KEY") or "").strip(),
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )
    return _s3_client


def _init_r2() -> str:
    s3 = _get_s3()
    bucket = (os.environ.get("R2_BUCKET") or "").strip()
    s3.head_bucket(Bucket=bucket)
    return f"r2://{bucket}"


def _put_r2(path: str, data: bytes, content_type: str) -> dict:
    key = _validate_key(path)
    s3 = _get_s3()
    bucket = (os.environ.get("R2_BUCKET") or "").strip()
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=_as_bytes(data),
        ContentType=content_type or "application/octet-stream",
    )
    return {"path": key}


def _get_r2(path: str) -> Tuple[bytes, str]:
    from botocore.exceptions import ClientError

    key = _validate_key(path)
    s3 = _get_s3()
    bucket = (os.environ.get("R2_BUCKET") or "").strip()
    try:
        resp = s3.get_object(Bucket=bucket, Key=key)
    except ClientError as e:
        code = (e.response.get("Error") or {}).get("Code", "")
        if code in ("NoSuchKey", "404", "NotFound"):
            raise FileNotFoundError(path) from e
        raise
    payload = resp["Body"].read()
    ctype = resp.get("ContentType") or "application/octet-stream"
    return payload, ctype


# ---------------------- Public API ----------------------

def init_storage():
    """Verify storage at startup. Called once from server.py."""
    backend = _backend()
    if backend == "r2":
        loc = _init_r2()
        logger.info("Cloudflare R2 storage ready (%s).", loc)
        return loc
    loc = _init_local()
    logger.info("Local blob storage ready at %s.", loc)
    return loc


def put_object(path: str, data: bytes, content_type: str) -> dict:
    if _backend() == "r2":
        return _put_r2(path, data, content_type)
    return _put_local(path, data, content_type)


def get_object(path: str) -> Tuple[bytes, str]:
    if _backend() == "r2":
        return _get_r2(path)
    return _get_local(path)

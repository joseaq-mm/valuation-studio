"""MongoDB client helpers (Atlas TLS works on macOS Python via certifi)."""
from __future__ import annotations

from typing import Any, Dict

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient


def _atlas_tls_opts(url: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    opts = dict(kwargs)
    if url.startswith("mongodb+srv://") or "tls=true" in url.lower():
        try:
            import certifi

            opts.setdefault("tlsCAFile", certifi.where())
        except ImportError:
            pass
    return opts


def make_motor_client(url: str, **kwargs: Any) -> AsyncIOMotorClient:
    return AsyncIOMotorClient(url, **_atlas_tls_opts(url, kwargs))


def make_pymongo_client(url: str, **kwargs: Any) -> MongoClient:
    return MongoClient(url, **_atlas_tls_opts(url, kwargs))

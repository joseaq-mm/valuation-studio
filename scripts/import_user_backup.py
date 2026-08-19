#!/usr/bin/env python3
"""Import a user-export.json (from export_via_api.py) into local MongoDB."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")
import sys
sys.path.insert(0, str(ROOT / "backend"))
from mongo_client import make_motor_client  # noqa: E402


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="in_path", required=True)
    p.add_argument("--url", default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    p.add_argument("--db", default=os.environ.get("DB_NAME", "test_database"))
    args = p.parse_args()

    path = Path(args.in_path)
    if not path.exists():
        print(f"No existe: {path}", file=sys.stderr)
        return 1

    data = json.loads(path.read_text(encoding="utf-8"))
    user = data.get("user") or {}
    uid = user.get("user_id")
    email = user.get("email")
    if not uid or not email:
        print("Export inválido: falta user.user_id o user.email", file=sys.stderr)
        return 1

    client = make_motor_client(args.url, serverSelectionTimeoutMS=20000)
    db = client[args.db]
    await client.admin.command("ping")

    now = datetime.now(timezone.utc).isoformat()

    # User row (same user_id → login Google con ese email reutiliza la cuenta)
    await db.users.update_one(
        {"email": email},
        {"$set": {
            "user_id": uid,
            "email": email,
            "name": user.get("name"),
            "picture": user.get("picture"),
            "notify": data.get("notify") or {},
            "last_login": now,
        }, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )

    port = data.get("portfolio") or {}
    await db.user_portfolios.update_one(
        {"user_id": uid},
        {"$set": {
            "user_id": uid,
            "positions": port.get("positions") or [],
            "deletions": port.get("deletions") or {},
            "updated_at": now,
        }},
        upsert=True,
    )

    wl = data.get("watchlist") or {}
    await db.user_watchlists.update_one(
        {"user_id": uid},
        {"$set": {
            "user_id": uid,
            "entries": wl.get("entries") or [],
            "deletions": wl.get("deletions") or {},
            "updated_at": now,
        }},
        upsert=True,
    )

    for folder in data.get("folders") or []:
        folder = dict(folder)
        folder["user_id"] = uid
        await db.thesis_folders.replace_one({"id": folder["id"], "user_id": uid}, folder, upsert=True)

    n_theses = 0
    for t in data.get("theses") or []:
        t = dict(t)
        t["user_id"] = uid
        await db.theses.replace_one({"id": t["id"], "user_id": uid}, t, upsert=True)
        n_theses += 1

    for ticker, cfg in (data.get("alerts") or {}).items():
        doc = dict(cfg)
        doc["user_id"] = uid
        doc["ticker"] = ticker
        await db.company_alerts.replace_one({"user_id": uid, "ticker": ticker}, doc, upsert=True)

    print(f"✓ Importado en {args.db}")
    print(f"  user: {email} ({uid})")
    print(f"  portfolio: {len(port.get('positions') or [])} posiciones")
    print(f"  watchlist: {len(wl.get('entries') or [])} entradas")
    print(f"  tesis: {n_theses}")
    print("\nReinicia el backend e inicia sesión con el MISMO Google.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

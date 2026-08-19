#!/usr/bin/env python3
"""Copy MongoDB data from Emergent (remote) into local MongoDB.

Usage:
  1. Get MONGO_URL + DB_NAME from Emergent (project env / dashboard).
  2. Run:
       cd backend && source venv/bin/activate  # or use venv python directly
       python ../scripts/migrate_mongo.py \\
         --remote-url 'mongodb+srv://...' \\
         --remote-db test_database

  Or set REMOTE_MONGO_URL and REMOTE_DB_NAME in the environment.

Local target reads backend/.env (MONGO_URL, DB_NAME).

Options:
  --drop-local   Replace local collections (default: merge/upsert by _id)
  --dry-run      List collections and doc counts only
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")

BATCH = 500


async def _count(client, db_name: str) -> dict[str, int]:
    db = client[db_name]
    out = {}
    for name in await db.list_collection_names():
        out[name] = await db[name].estimated_document_count()
    return out


async def _copy_collection(src_db, dst_db, name: str, *, drop_local: bool) -> int:
    if drop_local:
        await dst_db[name].drop()

    n = 0
    batch: list = []
    async for doc in src_db[name].find({}):
        batch.append(doc)
        if len(batch) >= BATCH:
            if drop_local and n == 0:
                await dst_db[name].insert_many(batch)
            else:
                for d in batch:
                    await dst_db[name].replace_one({"_id": d["_id"]}, d, upsert=True)
            n += len(batch)
            batch = []
    if batch:
        if drop_local and n == 0:
            await dst_db[name].insert_many(batch)
        else:
            for d in batch:
                await dst_db[name].replace_one({"_id": d["_id"]}, d, upsert=True)
        n += len(batch)
    return n


async def main() -> int:
    p = argparse.ArgumentParser(description="Migrate MongoDB from Emergent to local")
    p.add_argument("--remote-url", default=os.environ.get("REMOTE_MONGO_URL", ""))
    p.add_argument("--remote-db", default=os.environ.get("REMOTE_DB_NAME", "test_database"))
    p.add_argument("--local-url", default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    p.add_argument("--local-db", default=os.environ.get("DB_NAME", "valuation_studio"))
    p.add_argument("--drop-local", action="store_true", help="Drop each local collection before copy")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not args.remote_url:
        print("Error: --remote-url or REMOTE_MONGO_URL required.", file=sys.stderr)
        print("Find it in Emergent → your project → Environment / Secrets → MONGO_URL", file=sys.stderr)
        return 1

    print(f"Remote: {args.remote_db} @ {args.remote_url[:40]}...")
    print(f"Local:  {args.local_db} @ {args.local_url}")

    remote = AsyncIOMotorClient(args.remote_url, serverSelectionTimeoutMS=15000)
    local = AsyncIOMotorClient(args.local_url, serverSelectionTimeoutMS=5000)

    try:
        await remote.admin.command("ping")
        print("✓ Remote MongoDB reachable")
    except Exception as e:
        print(f"✗ Cannot reach remote MongoDB: {e}", file=sys.stderr)
        return 1

    try:
        await local.admin.command("ping")
        print("✓ Local MongoDB reachable")
    except Exception as e:
        print(f"✗ Cannot reach local MongoDB: {e}", file=sys.stderr)
        print("  Start it with: ./scripts/dev-local.sh", file=sys.stderr)
        return 1

    counts = await _count(remote, args.remote_db)
    if not counts:
        print("Remote database has no collections (check DB_NAME — Emergent often uses 'test_database').")
        return 1

    print("\nCollections on remote:")
    for name, c in sorted(counts.items()):
        print(f"  {name}: {c} docs")

    if args.dry_run:
        return 0

    src = remote[args.remote_db]
    dst = local[args.local_db]
    total = 0
    for name in sorted(counts.keys()):
        copied = await _copy_collection(src, dst, name, drop_local=args.drop_local)
        total += copied
        print(f"  → {name}: {copied} documents")

    print(f"\nDone. {total} documents copied into '{args.local_db}'.")
    print("Restart the backend if it was running.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

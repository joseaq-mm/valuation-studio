#!/usr/bin/env python3
"""Import MongoDB JSON export (from mongo_dump.py) into a database."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from bson import json_util
from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> int:
    p = argparse.ArgumentParser(description="Restore MongoDB from JSON export")
    p.add_argument("--url", default="mongodb://localhost:27017")
    p.add_argument("--db", default="valuation_studio")
    p.add_argument("--in", dest="in_dir", required=True, help="Folder with *.json (e.g. mongo-backup/test_database)")
    p.add_argument("--drop", action="store_true", help="Drop each collection before import")
    args = p.parse_args()

    in_dir = Path(args.in_dir)
    if not in_dir.is_dir():
        print(f"Not found: {in_dir}", file=sys.stderr)
        return 1

    client = AsyncIOMotorClient(args.url, serverSelectionTimeoutMS=10000)
    try:
        await client.admin.command("ping")
    except Exception as e:
        print(f"Cannot connect to {args.url}: {e}", file=sys.stderr)
        return 1

    db = client[args.db]
    total = 0

    for path in sorted(in_dir.glob("*.json")):
        if path.name == "_meta.json":
            continue
        coll_name = path.stem
        raw = path.read_text(encoding="utf-8")
        docs = json_util.loads(raw)
        if not docs:
            print(f"  {coll_name}: (empty, skip)")
            continue
        if args.drop:
            await db[coll_name].drop()
        if args.drop:
            await db[coll_name].insert_many(docs)
        else:
            for d in docs:
                await db[coll_name].replace_one({"_id": d["_id"]}, d, upsert=True)
        total += len(docs)
        print(f"  {coll_name}: {len(docs)} docs")

    print(f"\nImported {total} documents into '{args.db}' @ {args.url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

#!/usr/bin/env python3
"""Export a MongoDB database to JSON files (run where Mongo is reachable).

On Emergent (terminal / SSH in the preview pod):
  cd /app/backend   # or your backend path
  python ../scripts/mongo_dump.py --url mongodb://localhost:27017 --db test_database --out ../mongo-backup

Download the mongo-backup/ folder to your Mac, then:
  python scripts/mongo_restore.py --url mongodb://localhost:27017 --db valuation_studio --in mongo-backup/test_database
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from bson import json_util
from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> int:
    p = argparse.ArgumentParser(description="Export MongoDB collections to JSON")
    p.add_argument("--url", default="mongodb://localhost:27017")
    p.add_argument("--db", default="test_database")
    p.add_argument("--out", default="mongo-backup")
    args = p.parse_args()

    client = AsyncIOMotorClient(args.url, serverSelectionTimeoutMS=10000)
    try:
        await client.admin.command("ping")
    except Exception as e:
        print(f"Cannot connect to {args.url}: {e}", file=sys.stderr)
        return 1

    db = client[args.db]
    out_dir = Path(args.out) / args.db
    out_dir.mkdir(parents=True, exist_ok=True)

    meta = {"db": args.db, "url": args.url, "exported_at": datetime.now(timezone.utc).isoformat(), "collections": {}}
    total = 0

    for coll_name in sorted(await db.list_collection_names()):
        docs = await db[coll_name].find({}).to_list(None)
        path = out_dir / f"{coll_name}.json"
        path.write_text(json_util.dumps(docs, indent=2), encoding="utf-8")
        meta["collections"][coll_name] = len(docs)
        total += len(docs)
        print(f"  {coll_name}: {len(docs)} docs → {path}")

    (out_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"\nExported {total} documents from '{args.db}' to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

"""One-off backfill: set `source_company_thesis_id` on existing developed trend
theses. Source of truth: each company thesis (`type=company`) tracks the trend
theses born from its plan via `split_dev[].developed_id`. We walk all company
theses and stamp `source_company_thesis_id = <company_id>` on each developed
trend so the company→thesis planning view can filter to ONLY the trends born
from THIS company's plan (excluding auto-included memberships from other plans).

Run:  python backfill_source_company_thesis.py
Idempotent: re-running keeps the same value.
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    companies = await db.theses.find(
        {"type": "company", "split_dev.0": {"$exists": True}},
        {"_id": 0, "id": 1, "user_id": 1, "split_dev": 1},
    ).to_list(length=5000)
    tagged, skipped = 0, 0
    for comp in companies:
        uid = comp.get("user_id")
        cid = comp.get("id")
        if not (uid and cid):
            continue
        for entry in (comp.get("split_dev") or []):
            dev_id = entry.get("developed_id")
            if not dev_id:
                continue
            res = await db.theses.update_one(
                {"id": dev_id, "user_id": uid, "type": "trend"},
                {"$set": {"source_company_thesis_id": cid}},
            )
            if res.matched_count:
                tagged += 1
            else:
                skipped += 1
    print(f"Backfill done: tagged {tagged} developed theses; skipped {skipped} (not found).")
    cli.close()


if __name__ == "__main__":
    asyncio.run(main())

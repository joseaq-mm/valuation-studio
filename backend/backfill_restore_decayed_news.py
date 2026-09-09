"""One-off backfill: undo the old 45-day relevance-decay pruning of `kpi_news`.

Before this change, `prune_news` soft-deleted (`is_deleted=True`) news items once
their relevance decayed below a threshold, even if the company had far fewer than
15 items total. The new `prune_news` only caps by count (15 most recent). This
script re-applies the NEW rule to every (company_id, user_id) group across ALL
their news (deleted or not), restoring anything that was dropped purely by the
old decay logic while still capping each company to its 15 most recent items.

Run:  python backfill_restore_decayed_news.py
Idempotent: re-running keeps the same result.
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient

from services.kpi import prune_news


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    groups = await db.kpi_news.distinct("company_id")
    restored, kept_deleted, groups_seen = 0, 0, 0
    for company_id in groups:
        items = await db.kpi_news.find({"company_id": company_id}, {"_id": 0}).to_list(length=500)
        if not items:
            continue
        user_id = items[0].get("user_id")
        groups_seen += 1
        kept, dropped = prune_news(items)
        kept_ids = {n["id"] for n in kept if n.get("id")}
        dropped_ids = {n["id"] for n in dropped if n.get("id")}
        for nid in kept_ids:
            res = await db.kpi_news.update_one(
                {"id": nid, "company_id": company_id, "user_id": user_id, "is_deleted": True},
                {"$set": {"is_deleted": False}})
            if res.modified_count:
                restored += 1
        for nid in dropped_ids:
            res = await db.kpi_news.update_one(
                {"id": nid, "company_id": company_id, "user_id": user_id, "is_deleted": False},
                {"$set": {"is_deleted": True}})
            kept_deleted += res.modified_count
    print(f"Backfill done: {groups_seen} companies scanned, {restored} news items restored, "
          f"{kept_deleted} left/marked deleted (over the 15-cap).")
    cli.close()


if __name__ == "__main__":
    asyncio.run(main())

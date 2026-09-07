"""One-off migration: convert the old monthly `visual_snapshots` docs (one doc per
user+ticker+month bundling all 5 axes) into the new per-metric event history in
`visual_metric_events` (one doc per user+ticker+metric+date), which now powers both
the Visual bubble timeline and the per-company classic history chart.

Each old {score, tam, rc, rv, kpi_coef} bundle becomes up to 5 new event docs, dated
the 1st of that month (the old data has no day-level precision). Idempotent: re-running
just upserts the same (user, ticker, metric, date) keys again.

Run:  python backfill_visual_snapshots_to_events.py
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient

METRICS = ["score", "tam", "rc", "rv", "kpi_coef"]


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    docs = await db.visual_snapshots.find({}, {"_id": 0}).to_list(length=200000)
    written = 0
    for d in docs:
        uid, tk, month = d.get("user_id"), d.get("ticker"), d.get("month")
        if not (uid and tk and month):
            continue
        date = f"{month}-01"
        recorded_at = d.get("recorded_at")
        for metric in METRICS:
            val = d.get(metric)
            if val is None:
                continue
            await db.visual_metric_events.update_one(
                {"user_id": uid, "ticker": tk, "metric": metric, "date": date},
                {"$set": {"user_id": uid, "ticker": tk, "metric": metric, "date": date,
                          "value": val, "recorded_at": recorded_at}},
                upsert=True,
            )
            written += 1
    print(f"Backfill done: {len(docs)} old monthly snapshots → {written} per-metric events.")
    cli.close()


if __name__ == "__main__":
    asyncio.run(main())

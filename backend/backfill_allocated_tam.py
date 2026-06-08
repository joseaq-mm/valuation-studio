"""One-off backfill for Option A (partition authority): set `origin_ticker` and
`allocated_tam_busd` on existing developed trend theses, derived from the company
partition via `split_dev`. Then recompute the frozen TAM Scores.

Run:  python backfill_allocated_tam.py
Idempotent: re-running just recomputes the same values.
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from thesis_refresh import recompute_and_store_tam


def _nrm(x):
    return (x or "").strip().lower()


def _slice_for(driver, entry):
    """TAM slice the developed thesis inherits (driver authoritative; splits normalized)."""
    dtam = driver.get("tam_busd")
    splits = driver.get("splits") or []
    if entry.get("whole") or not splits:
        return dtam
    ssum = sum((s.get("tam_busd") or 0) for s in splits)
    sp = next((s for s in splits if _nrm(s.get("name")) == _nrm(entry.get("split"))), None)
    sp_tam = (sp or {}).get("tam_busd")
    if sp_tam is not None and dtam and ssum:
        return round(float(sp_tam) * float(dtam) / float(ssum), 1)
    return sp_tam


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    companies = await db.theses.find(
        {"type": "company", "split_dev.0": {"$exists": True}}, {"_id": 0}
    ).to_list(length=5000)
    anchored, users = 0, set()
    for comp in companies:
        uid = comp.get("user_id")
        ticker = ((comp.get("company") or {}).get("ticker") or "").upper().strip() or None
        trends = comp.get("trends") or []
        for entry in (comp.get("split_dev") or []):
            dev_id = entry.get("developed_id")
            if not dev_id:
                continue
            driver = next((t for t in trends if _nrm(t.get("name")) == _nrm(entry.get("core"))), None)
            if driver is None:
                continue
            alloc = _slice_for(driver, entry)
            patch = {"origin_ticker": ticker}
            if alloc is not None:
                patch["allocated_tam_busd"] = alloc
            res = await db.theses.update_one(
                {"id": dev_id, "user_id": uid, "type": "trend"}, {"$set": patch})
            if res.matched_count:
                anchored += 1
                if uid:
                    users.add(uid)
    for uid in users:
        await recompute_and_store_tam(db, uid)
    print(f"Backfill done: anchored {anchored} developed theses across {len(users)} users.")
    cli.close()


if __name__ == "__main__":
    asyncio.run(main())

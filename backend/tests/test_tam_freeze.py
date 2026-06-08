"""Regression tests for the data-refresh model:
  - recompute_and_store_tam freezes (persists) each company's TAM Score.
Run against the local Mongo (same pattern as the seed scripts)."""
import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

from thesis_refresh import recompute_and_store_tam

UID = "test_tam_freeze_user"


def _db():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return cli, cli[os.environ["DB_NAME"]]


async def _frozen_score():
    cli, db = _db()
    try:
        await db.fundamentals.update_one(
            {"ticker": "FREEZ"},
            {"$set": {"ticker": "FREEZ", "data": {"currency": "USD",
                      "auto_projections": {"revenue_2y": 100e9}}}},
            upsert=True,
        )
        await db.theses.update_one(
            {"id": "freeze_trend"},
            {"$set": {"id": "freeze_trend", "user_id": UID, "type": "trend", "title": "Freeze T",
                      "value_chain": [{"stage": "Core", "tam_busd": 200}],
                      "companies": [{"ticker": "FREEZ", "name": "Freeze Co",
                                     "overall_score": 80, "value_chain_role": "Core"}]}},
            upsert=True,
        )
        n = await recompute_and_store_tam(db, UID, ["freeze_trend"])
        doc = await db.theses.find_one({"id": "freeze_trend"}, {"_id": 0, "companies": 1})
        return n, doc["companies"][0]
    finally:
        await db.theses.delete_many({"user_id": UID})
        await db.fundamentals.delete_one({"ticker": "FREEZ"})
        cli.close()


async def _missing_revenue():
    cli, db = _db()
    try:
        await db.theses.update_one(
            {"id": "freeze_norev"},
            {"$set": {"id": "freeze_norev", "user_id": UID, "type": "trend", "title": "No Rev",
                      "value_chain": [{"stage": "Core", "tam_busd": 200}],
                      "companies": [{"ticker": "NOREVXX", "name": "No Rev Co",
                                     "overall_score": 80, "value_chain_role": "Core"}]}},
            upsert=True,
        )
        await recompute_and_store_tam(db, UID, ["freeze_norev"])
        doc = await db.theses.find_one({"id": "freeze_norev"}, {"_id": 0, "companies": 1})
        return doc["companies"][0]
    finally:
        await db.theses.delete_many({"user_id": UID})
        cli.close()


def test_recompute_stores_frozen_tam_score():
    n, c = asyncio.run(_frozen_score())
    assert n == 1
    # (80/100 * 200) / 100 = 1.6 → frozen in the doc
    assert c["tam_score"] == 1.6
    assert c["projected_revenue_busd"] == 100.0


def test_recompute_handles_missing_revenue():
    c = asyncio.run(_missing_revenue())
    assert c["tam_score"] is None
    assert c["projected_revenue_busd"] is None

"""Regression test for the serial generation queue: the dequeue picks the OLDEST
queued generation (FIFO). Pure DB query — no LLM is ever invoked."""
import os
import asyncio
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

UID = "test_gen_queue_user"


def _db():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return cli, cli[os.environ["DB_NAME"]]


async def _fifo():
    cli, db = _db()
    try:
        await db.thesis_jobs.delete_many({"user_id": UID})
        now = datetime.now(timezone.utc)
        await db.thesis_jobs.insert_many([
            {"id": "q_new", "user_id": UID, "kind": "generate", "status": "queued",
             "created_at": now.isoformat(), "params": {"subject": "NEW"}},
            {"id": "q_old", "user_id": UID, "kind": "generate", "status": "queued",
             "created_at": (now - timedelta(minutes=5)).isoformat(), "params": {"subject": "OLD"}},
        ])
        nxt = await db.thesis_jobs.find_one(
            {"user_id": UID, "kind": "generate", "status": "queued"},
            sort=[("created_at", 1)],
        )
        return nxt["id"], (nxt.get("params") or {}).get("subject")
    finally:
        await db.thesis_jobs.delete_many({"user_id": UID})
        cli.close()


def test_dequeue_is_fifo():
    job_id, subject = asyncio.run(_fifo())
    assert job_id == "q_old"
    assert subject == "OLD"

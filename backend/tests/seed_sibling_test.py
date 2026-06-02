"""Seed a SIBLING trend thesis (trend_match_id=thesis_test_aidc) that contains
MSFT, to verify link-suggestions reports already_in=True for the MSFT company
thesis even though MSFT is NOT directly in thesis_test_aidc."""
import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
USER_ID = "test_profile_user_123"


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    await db.theses.delete_many({"user_id": USER_ID, "id": "thesis_test_sibling_aidc"})
    doc = {
        "id": "thesis_test_sibling_aidc", "user_id": USER_ID, "type": "trend",
        "title": "IA y centros de datos (generada de todas formas)",
        "trend_match_id": "thesis_test_aidc",
        "folder_id": None, "saved": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "value_chain": [{"stage": "Plataforma cloud/software", "description": "", "tam_busd": 400.0}],
        "companies": [{"name": "Microsoft", "ticker": "MSFT", "value_chain_role": "Plataforma cloud/software",
                       "category": "leader", "overall_score": 90}],
    }
    await db.theses.insert_one(doc)
    print("SEEDED sibling thesis (trend_match_id=thesis_test_aidc) with MSFT")


asyncio.run(main())

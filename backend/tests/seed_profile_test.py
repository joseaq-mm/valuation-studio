"""Seed a throwaway user + session + two trend theses containing NVDA, then
print the Bearer token to test GET /thesis/company/NVDA/profile end-to-end."""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

TOKEN = "test_profile_token_fixed_123"
USER_ID = "test_profile_user_123"


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    await db.users.update_one(
        {"user_id": USER_ID},
        {"$set": {"user_id": USER_ID, "email": "profiletest@example.com", "name": "Profile Test"}},
        upsert=True,
    )
    await db.user_sessions.update_one(
        {"session_token": TOKEN},
        {"$set": {
            "session_token": TOKEN,
            "user_id": USER_ID,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }},
        upsert=True,
    )

    # Clean prior test theses
    await db.theses.delete_many({"user_id": USER_ID})

    theses = [
        {
            "id": "thesis_test_aidc", "user_id": USER_ID, "type": "trend",
            "title": "IA y centros de datos", "created_at": datetime.now(timezone.utc).isoformat(),
            "value_chain": [{"stage": "Computación acelerada", "description": "", "tam_busd": 500.0}],
            "companies": [{"name": "NVIDIA", "ticker": "NVDA", "value_chain_role": "Computación acelerada",
                           "category": "leader", "overall_score": 92}],
        },
        {
            "id": "thesis_test_robot", "user_id": USER_ID, "type": "trend",
            "title": "Robótica e IA física", "created_at": datetime.now(timezone.utc).isoformat(),
            "value_chain": [{"stage": "Cómputo de inferencia", "description": "", "tam_busd": 300.0}],
            "companies": [{"name": "NVIDIA", "ticker": "NVDA", "value_chain_role": "Cómputo de inferencia",
                           "category": "leader", "overall_score": 78}],
        },
    ]
    await db.theses.insert_many(theses)
    print("SEEDED")
    print("TOKEN", TOKEN)


asyncio.run(main())

import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv()

async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    doc = {
        "id": "co_ir_ui",
        "user_id": "test_profile_user_123",
        "type": "company",
        "company": {"name": "NVIDIA", "ticker": "NVDA"},
        "trends": [{"name": "Cómputo acelerado IA", "type": "actual", "plan": "whole", "tam_busd": 800}],
        "split_dev": [{"core": "Cómputo acelerado IA", "whole": True}],
        "ir_urls": ["https://investor.nvidia.com/news/default.aspx"],
    }
    await db.theses.update_one({"id": "co_ir_ui"}, {"$set": doc}, upsert=True)
    print("SEEDED co_ir_ui (NVDA) complete company with 1 IR url")

asyncio.run(main())

"""Seed a COMPANY thesis with a splittable driver to exercise the Plan→Execute UI
(plan markers 'Conjunto'/'Particiones' + the 'Generar plan' bar). No split_dev →
planning is OPEN. Re-run to reset (clears any plan markers)."""
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
    await db.theses.delete_one({"id": "co_plan_ui", "user_id": USER_ID})
    doc = {
        "id": "co_plan_ui", "user_id": USER_ID, "type": "company",
        "title": "NVIDIA (plan test)", "query": "NVDA",
        "folder_id": None, "saved": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "company": {"name": "NVIDIA", "ticker": "NVDA"},
        "summary": "NVIDIA lidera el cómputo acelerado para IA. Demo para planificar el plan.",
        "split_dev": [],
        "link_matches": None,
        "trends": [
            {"name": "Cómputo acelerado IA", "type": "actual",
             "fit_description": "GPUs y CUDA para entrenamiento e inferencia.",
             "value_chain_role": "Computación acelerada", "relevance_score": 95,
             "win_probability": 9, "tam_busd": 800,
             "rationale": "Núcleo del negocio en plena expansión.",
             "splits": [
                 {"name": "Entrenamiento de modelos", "tam_busd": 450},
                 {"name": "Inferencia en producción", "tam_busd": 350},
             ]},
            {"name": "Redes para clústeres IA", "type": "actual",
             "fit_description": "InfiniBand / NVLink para interconexión de GPUs.",
             "value_chain_role": "Redes", "relevance_score": 82,
             "win_probability": 8, "tam_busd": 70,
             "rationale": "Cuello de botella crítico de los clústeres."},
            {"name": "Robótica y simulación física", "type": "futura",
             "fit_description": "Omniverse + Isaac para robots y gemelos digitales.",
             "value_chain_role": "Plataforma de simulación", "relevance_score": 71,
             "win_probability": 7, "tam_busd": 80,
             "rationale": "Apuesta de futuro con sinergia y moat."},
        ],
        "overall_relevance": 92,
        "contra": None, "sources": [],
    }
    await db.theses.insert_one(doc)
    print("SEEDED company thesis co_plan_ui (NVDA) with a splittable driver for", USER_ID)


asyncio.run(main())

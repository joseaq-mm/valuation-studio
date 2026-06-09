"""Seed a LOCKED company thesis with a still-pending driver and a merged proposal,
to verify the recovery UI: the 'Reanudar generación' button (resume-plan-btn) and
that the 'Tesis fusionadas' (revert) section is HIDDEN once planning is locked.
Pre-seeds link_matches with the right signature so the LLM matcher is skipped."""
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
    await db.theses.delete_one({"id": "co_locked_ui", "user_id": USER_ID})
    await db.theses.delete_one({"id": "dev_locked_1", "user_id": USER_ID})

    now = datetime.now(timezone.utc).isoformat()
    # A real developed trend thesis so split_dev isn't pruned (keeps planning locked).
    dev = {
        "id": "dev_locked_1", "user_id": USER_ID, "type": "trend",
        "title": "Plataforma RNAi (generada)", "saved": True,
        "folder_id": None, "parent_id": None, "created_at": now,
        "summary": "Tesis desarrollada del driver Plataforma RNAi.",
        "tam": {"global_busd": 50, "year": 2027}, "value_chain": [], "companies": [],
        "origin_ticker": "ALNY", "allocated_tam_busd": 50,
    }
    await db.theses.insert_one(dev)

    # Compute the matcher cache signature (sorted ids of all the user's trend theses)
    # so link-suggestions short-circuits (no LLM call on load).
    trend_ids = sorted([d["id"] for d in await db.theses.find(
        {"user_id": USER_ID, "type": "trend"}, {"_id": 0, "id": 1}).to_list(500)])

    doc = {
        "id": "co_locked_ui", "user_id": USER_ID, "type": "company",
        "title": "Alnylam (locked test)", "query": "ALNY",
        "folder_id": None, "saved": True, "created_at": now,
        "company": {"name": "Alnylam", "ticker": "ALNY"},
        "summary": "Demo: planificación cerrada con una tesis pendiente y una fusionada.",
        "split_dev": [
            {"core": "Plataforma RNAi", "split": None, "developed_id": "dev_locked_1", "whole": True},
        ],
        "link_matches": {
            "v": 2, "sig": trend_ids,
            "to_add": [],
            "to_create": [{"trend_name": "Terapias hepáticas", "why": ""}],
            "updated_at": now,
        },
        "trends": [
            {"name": "Plataforma RNAi", "type": "actual", "tam_busd": 50,
             "fit_description": "Núcleo RNAi.", "value_chain_role": "Plataforma",
             "relevance_score": 90, "win_probability": 8, "plan": "whole",
             "rationale": "Ya desarrollada."},
            {"name": "Terapias hepáticas", "type": "actual", "tam_busd": 20,
             "fit_description": "Cartera hepática.", "value_chain_role": "Terapia",
             "relevance_score": 78, "win_probability": 7, "plan": "whole",
             "rationale": "Pendiente de generarse (quedó en cola)."},
            {"name": "Cardiometabólico", "type": "futura", "tam_busd": 15,
             "fit_description": "Adyacencia cardiometabólica.", "value_chain_role": "Terapia",
             "relevance_score": 65, "win_probability": 6,
             "merged_into": "Plataforma RNAi", "rationale": "Fusionada."},
        ],
        "overall_relevance": 85, "contra": None, "sources": [],
    }
    await db.theses.insert_one(doc)
    print("SEEDED co_locked_ui (ALNY) — locked, 1 pending driver + 1 merged. sig:", trend_ids)


asyncio.run(main())

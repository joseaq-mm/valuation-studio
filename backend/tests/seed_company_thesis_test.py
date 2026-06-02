"""Seed a COMPANY-type thesis for the test user so the trend cards + duplicate
warning can be exercised. One of its trends ('Inteligencia artificial y centros
de datos') should match the existing trend thesis 'IA y centros de datos'."""
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
    await db.theses.delete_many({"user_id": USER_ID, "type": "company"})
    doc = {
        "id": "thesis_test_company_msft", "user_id": USER_ID, "type": "company",
        "title": "Microsoft", "query": "MSFT",
        "folder_id": None, "saved": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "company": {"name": "Microsoft", "ticker": "MSFT"},
        "summary": "Microsoft es un gigante del software y la nube (Azure) muy expuesto a la IA.",
        "trends": [
            {"name": "Inteligencia artificial y centros de datos",
             "fit_description": "Azure + Copilot + capacidad de cómputo IA.",
             "value_chain_role": "Plataforma cloud/software", "relevance_score": 95,
             "rationale": "La IA es el principal motor de crecimiento de Azure."},
            {"name": "Ciberseguridad empresarial",
             "fit_description": "Microsoft Defender, Entra, Security Copilot.",
             "value_chain_role": "Seguridad", "relevance_score": 80,
             "rationale": "Negocio de seguridad creciendo a doble dígito."},
        ],
        "overall_relevance": 88,
        "contra": None, "sources": [],
    }
    # NVDA company thesis: its IA trend matches thesis_test_aidc, where NVDA ALREADY
    # appears → exercises the "ya está en esta tesis" notice (no add button).
    doc_nvda = {
        "id": "thesis_test_company_nvda", "user_id": USER_ID, "type": "company",
        "title": "NVIDIA", "query": "NVDA",
        "folder_id": None, "saved": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "company": {"name": "NVIDIA", "ticker": "NVDA"},
        "summary": "NVIDIA lidera el cómputo acelerado para IA.",
        "trends": [
            {"name": "Inteligencia artificial y centros de datos",
             "fit_description": "GPUs y plataforma CUDA para entrenamiento e inferencia.",
             "value_chain_role": "Computación acelerada", "relevance_score": 98,
             "rationale": "Motor central del negocio."},
        ],
        "overall_relevance": 96,
        "contra": None, "sources": [],
    }
    await db.theses.insert_many([doc, doc_nvda])
    print("SEEDED company theses: thesis_test_company_msft (MSFT) + thesis_test_company_nvda (NVDA) for", USER_ID)


asyncio.run(main())

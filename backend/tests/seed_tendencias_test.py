"""Seed tendencias (Tendencias → Empresas) in the NEW format (TAM 2027, forward 4y CAGR,
multi-paragraph summary, 3 company categories) + one megatendencia (folder) grouping
two of them. Lets us verify the dashboard sidebar, treemap (size ∝ CAGR) and folder
aggregation (avg CAGR + sum TAM) without any LLM call."""
import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
USER_ID = "test_profile_user_123"


def comp(name, ticker, category, role, why):
    return {"name": name, "ticker": ticker, "category": category, "value_chain_role": role, "why": why}


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    for tid in ["td_datacenter", "td_humanoid", "td_smr"]:
        await db.theses.delete_one({"id": tid, "user_id": USER_ID})
    await db.thesis_folders.delete_one({"id": "mt_ia", "user_id": USER_ID})

    now = datetime.now(timezone.utc).isoformat()
    await db.thesis_folders.insert_one({"id": "mt_ia", "user_id": USER_ID, "name": "Inteligencia Artificial", "created_at": now})

    summary = (
        "La construcción de centros de datos para IA vive una expansión sin precedentes, "
        "impulsada por el entrenamiento y la inferencia de modelos cada vez mayores.\n\n"
        "La demanda de cómputo acelerado, memoria de alto ancho de banda y redes de baja "
        "latencia crece más rápido que la capacidad instalada, generando cuellos de botella.\n\n"
        "La cadena de valor abarca silicio, sistemas, refrigeración líquida, energía y operación "
        "de la infraestructura, con márgenes muy distintos en cada eslabón.\n\n"
        "Los riesgos principales son la disponibilidad de energía, la concentración de proveedores "
        "y un posible exceso de capacidad si el gasto en IA se modera.\n\n"
        "En un horizonte de 4 años esperamos crecimiento de doble dígito alto sostenido por la "
        "adopción empresarial y soberana de la IA."
    )
    docs = [
        {
            "id": "td_datacenter", "user_id": USER_ID, "type": "tendencia", "saved": True,
            "folder_id": "mt_ia", "created_at": now,
            "title": "Centros de datos para IA", "query": "centros de datos IA",
            "summary": summary,
            "tam": {"global_busd": 900, "year": 2027, "note": "Gasto global en infraestructura de cómputo IA."},
            "cagr_4y": 28.0, "cagr_note": "Crecimiento sostenido por entrenamiento e inferencia a gran escala.",
            "companies": [
                comp("NVIDIA", "NVDA", "leader", "GPUs y CUDA", "Estándar de facto del cómputo acelerado."),
                comp("Broadcom", "AVGO", "leader", "Silicio de red e interconexión", "Clave en switching y ASICs personalizados."),
                comp("AMD", "AMD", "competitor", "GPUs/CPU de datacenter", "Gana terreno con MI300 en inferencia."),
                comp("Vertiv", "VRT", "competitor", "Refrigeración y energía", "Acelera con la refrigeración líquida."),
                comp("Cerebras", None, "disruptor", "Wafer-scale compute", "Arquitectura radicalmente distinta para IA."),
                comp("Groq", None, "disruptor", "LPUs de inferencia", "Inferencia ultrarrápida que amenaza a las GPU."),
            ],
            "value_chain": [], "sources": [],
        },
        {
            "id": "td_humanoid", "user_id": USER_ID, "type": "tendencia", "saved": True,
            "folder_id": "mt_ia", "created_at": now,
            "title": "Robótica humanoide", "query": "robots humanoides",
            "summary": "Los robots humanoides de propósito general empiezan a salir del laboratorio.\n\nLa convergencia de IA, actuadores baratos y visión hace viable la automatización física.\n\nEl mercado es incipiente pero con un techo enorme en logística e industria.",
            "tam": {"global_busd": 120, "year": 2027, "note": "Estimación temprana del mercado de humanoides."},
            "cagr_4y": 35.0, "cagr_note": "Partida desde una base muy pequeña con adopción acelerada.",
            "companies": [
                comp("Tesla", "TSLA", "leader", "Robot Optimus", "Integración vertical IA + manufactura."),
                comp("ABB", "ABB", "competitor", "Robótica industrial", "Extiende su base instalada hacia humanoides."),
                comp("Figure AI", None, "disruptor", "Humanoide de propósito general", "Apuesta pura de paradigma nuevo."),
            ],
            "value_chain": [], "sources": [],
        },
        {
            "id": "td_smr", "user_id": USER_ID, "type": "tendencia", "saved": True,
            "folder_id": None, "created_at": now,
            "title": "Reactores nucleares modulares (SMR)", "query": "SMR nuclear",
            "summary": "Los SMR prometen energía base limpia y desplegable para alimentar la IA.\n\nLa regulación y la financiación son los principales frenos a corto plazo.",
            "tam": {"global_busd": 60, "year": 2027, "note": "Mercado temprano de SMR."},
            "cagr_4y": 18.0, "cagr_note": "Crecimiento condicionado a aprobaciones regulatorias.",
            "companies": [
                comp("Constellation Energy", "CEG", "leader", "Operación nuclear", "Mayor operador nuclear de EE. UU."),
                comp("Oklo", "OKLO", "disruptor", "Microrreactores", "Modelo de negocio y diseño disruptivos."),
            ],
            "value_chain": [], "sources": [],
        },
    ]
    await db.theses.insert_many(docs)
    print("SEEDED 3 tendencias + megatendencia 'Inteligencia Artificial' for", USER_ID)


asyncio.run(main())

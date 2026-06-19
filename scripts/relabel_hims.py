import asyncio
import os
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
import sys
sys.path.insert(0, "/app/backend")
from services.thesis import _llm  # noqa

COMPANY_ID = "thesis_bc2a894ffd8f"  # HIMS

TITLE_SYS = (
    "Eres un asistente que pone títulos cortos y descriptivos a documentos financieros. "
    "Dado el nombre de archivo y un extracto de su contenido, devuelve SOLO un título breve "
    "(máx. 10 palabras) que incluya el TIPO de documento y su PERIODO o TEMA. "
    "Ejemplos: 'Presentación resultados Q1 2026', 'Transcript earnings call mayo 2026', "
    "'Gráfico TTM suscriptores desde 2021'. Responde únicamente con el título, sin comillas ni prefijos."
)


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    files = await db.kpi_files.find(
        {"company_id": COMPANY_ID, "is_deleted": False}, {"_id": 0}
    ).to_list(length=50)
    for f in files:
        fn = f.get("original_filename") or ""
        txt = (f.get("extracted_text") or "")[:1500]
        ctype = f.get("content_type") or ""
        hint = "imagen" if ctype.startswith("image/") else ("transcript" if "transcript" in fn.lower() else "documento")
        user = (f"NOMBRE DE ARCHIVO: {fn}\nTIPO APROX: {hint}\n\nEXTRACTO DEL CONTENIDO:\n{txt or '(sin texto)'}\n\nDevuelve el título.")
        title = await _llm("gemini", "gemini-2.5-flash",
                           f"relabel-{datetime.now(timezone.utc).timestamp()}",
                           TITLE_SYS, user)
        title = (title or "").strip().strip('"').strip("*").splitlines()[0][:120] if title else None
        if title:
            await db.kpi_files.update_one({"id": f["id"]}, {"$set": {"display_name": title}})
            print(f"{fn}\n   -> {title}\n")
        else:
            print(f"{fn} -> (sin título generado)")


asyncio.run(main())

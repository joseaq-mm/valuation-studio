"""Thesis Engine routes — qualitative AI module.

Generation works for anyone (anonymous gets an ephemeral result). Saving to
folders, listing and the per-company qualitative view require Google login,
reusing the existing auth dependencies from auth.py.
"""
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from services.thesis import (
    gather_sources, run_trend_thesis, run_company_thesis,
    run_trend_contra, run_company_contra,
)

logger = logging.getLogger(__name__)

# Keep strong references to background tasks so they are not garbage-collected.
_BG_TASKS: set = set()


def _spawn(coro):
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


def _generate_sync(kind: str, subject: str) -> dict:
    """Run the full (blocking) generation pipeline in a worker thread.

    emergentintegrations' LLM calls are synchronous and would otherwise block the
    main event loop for ~1 min, freezing job-status polling. We run the whole
    async pipeline inside its own event loop in a thread (via asyncio.to_thread).
    """
    sources = gather_sources(subject, kind)
    if kind == "trend":
        return asyncio.run(run_trend_thesis(subject, sources))
    return asyncio.run(run_company_thesis(subject, sources))


def _contra_sync(doc: dict) -> dict:
    if doc.get("type") == "company":
        name = (doc.get("company") or {}).get("name") or doc.get("title") or doc.get("query")
        return asyncio.run(run_company_contra(name, doc.get("summary") or ""))
    return asyncio.run(run_trend_contra(doc.get("title") or doc.get("query"), doc.get("summary") or ""))


class GenerateRequest(BaseModel):
    type: str  # "trend" | "company"
    subject: str


class FolderRequest(BaseModel):
    name: str


class AssignFolderRequest(BaseModel):
    folder_id: Optional[str] = None


def make_router(db: AsyncIOMotorDatabase, auth_required, auth_optional) -> APIRouter:
    router = APIRouter(prefix="/thesis")

    async def _persist_qual_snapshots(user_id: str, thesis_id: str, thesis: Dict[str, Any]):
        """Index every company by canonical TICKER so the qualitative view links
        to the quantitative /company/{ticker} dashboard (and future fusion)."""
        if thesis.get("type") == "trend":
            for c in thesis.get("companies", []):
                tk = (c.get("ticker") or "").upper().strip()
                if not tk:
                    continue
                await db.qual_snapshots.update_one(
                    {"user_id": user_id, "ticker": tk},
                    {"$set": {
                        "user_id": user_id,
                        "ticker": tk,
                        "name": c.get("name"),
                        "trend": thesis.get("title"),
                        "value_chain_role": c.get("value_chain_role"),
                        "scores": c.get("scores"),
                        "overall_score": c.get("overall_score"),
                        "thesis": c.get("thesis"),
                        "key_risks": c.get("key_risks"),
                        "thesis_id": thesis_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )
        elif thesis.get("type") == "company":
            tk = (thesis.get("company", {}).get("ticker") or "").upper().strip()
            if tk:
                await db.qual_snapshots.update_one(
                    {"user_id": user_id, "ticker": tk},
                    {"$set": {
                        "user_id": user_id,
                        "ticker": tk,
                        "name": thesis.get("company", {}).get("name"),
                        "company_trends": thesis.get("trends"),
                        "overall_relevance": thesis.get("overall_relevance"),
                        "thesis_id": thesis_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )

    async def _run_generate_job(job_id: str, kind: str, subject: str, user_id: Optional[str]):
        try:
            thesis = await asyncio.to_thread(_generate_sync, kind, subject)
            if user_id:
                tid = f"thesis_{uuid.uuid4().hex[:12]}"
                doc = {
                    "id": tid,
                    "user_id": user_id,
                    "folder_id": None,
                    "saved": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    **thesis,
                }
                await db.theses.insert_one(doc)
                await _persist_qual_snapshots(user_id, tid, thesis)
                thesis["id"] = tid
                thesis["saved"] = False
            else:
                thesis["id"] = None
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": thesis, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except ValueError as e:
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": str(e)}})
        except Exception as e:
            logger.error(f"thesis generation failed ({kind}:{subject}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": f"Error generando la tesis: {e}"}})

    async def _run_contra_job(job_id: str, thesis_id: str, user_id: str):
        try:
            doc = await db.theses.find_one({"id": thesis_id, "user_id": user_id}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Tesis no encontrada"}})
                return
            contra = await asyncio.to_thread(_contra_sync, doc)
            await db.theses.update_one({"id": thesis_id, "user_id": user_id}, {"$set": {"contra": contra}})
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": contra, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"contra generation failed ({thesis_id}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": f"Error generando la contratesis: {e}"}})

    @router.post("/generate")
    async def generate(req: GenerateRequest, user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        kind = req.type.strip().lower()
        subject = (req.subject or "").strip()
        if kind not in ("trend", "company"):
            raise HTTPException(status_code=400, detail="type debe ser 'trend' o 'company'")
        if not subject:
            raise HTTPException(status_code=400, detail="subject requerido")

        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id,
            "user_id": user["user_id"] if user else None,
            "kind": "generate",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_generate_job(job_id, kind, subject, user["user_id"] if user else None))
        return {"job_id": job_id}

    @router.get("/job/{job_id}")
    async def job_status(job_id: str, user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        job = await db.thesis_jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Trabajo no encontrado")
        owner = job.get("user_id")
        if owner and (not user or user["user_id"] != owner):
            raise HTTPException(status_code=404, detail="Trabajo no encontrado")
        return {"status": job.get("status"), "result": job.get("result"), "error": job.get("error")}

    @router.get("/list")
    async def list_theses(user: Dict[str, Any] = Depends(auth_required)):
        cur = db.theses.find(
            {"user_id": user["user_id"]},
            {"_id": 0, "id": 1, "type": 1, "title": 1, "query": 1, "folder_id": 1,
             "saved": 1, "created_at": 1, "overall_relevance": 1},
        ).sort("created_at", -1)
        items = await cur.to_list(length=500)
        # Add company count for trend theses (cheap second pass)
        return {"items": items}

    @router.get("/folders")
    async def list_folders(user: Dict[str, Any] = Depends(auth_required)):
        cur = db.thesis_folders.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
        folders = await cur.to_list(length=200)
        return {"folders": folders}

    @router.post("/folders")
    async def create_folder(req: FolderRequest, user: Dict[str, Any] = Depends(auth_required)):
        name = (req.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="nombre requerido")
        fid = f"folder_{uuid.uuid4().hex[:10]}"
        doc = {
            "id": fid,
            "user_id": user["user_id"],
            "name": name,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.thesis_folders.insert_one(doc)
        return {"id": fid, "name": name, "created_at": doc["created_at"]}

    @router.delete("/folders/{folder_id}")
    async def delete_folder(folder_id: str, user: Dict[str, Any] = Depends(auth_required)):
        await db.thesis_folders.delete_one({"id": folder_id, "user_id": user["user_id"]})
        # Detach theses from the deleted folder (keep the theses themselves).
        await db.theses.update_many(
            {"user_id": user["user_id"], "folder_id": folder_id},
            {"$set": {"folder_id": None}},
        )
        return {"ok": True}

    @router.get("/company/{ticker}")
    async def company_qual(ticker: str, user: Dict[str, Any] = Depends(auth_required)):
        tk = ticker.upper().strip()
        snap = await db.qual_snapshots.find_one(
            {"user_id": user["user_id"], "ticker": tk}, {"_id": 0}
        )
        if not snap:
            raise HTTPException(status_code=404, detail="Sin análisis cualitativo para este ticker")
        return snap

    @router.get("/{thesis_id}")
    async def get_thesis(thesis_id: str, user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"]}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        return doc

    @router.put("/{thesis_id}/folder")
    async def assign_folder(thesis_id: str, req: AssignFolderRequest, user: Dict[str, Any] = Depends(auth_required)):
        if req.folder_id:
            folder = await db.thesis_folders.find_one({"id": req.folder_id, "user_id": user["user_id"]}, {"_id": 0})
            if not folder:
                raise HTTPException(status_code=404, detail="Carpeta no encontrada")
        res = await db.theses.update_one(
            {"id": thesis_id, "user_id": user["user_id"]},
            {"$set": {"folder_id": req.folder_id, "saved": True}},
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        return {"ok": True, "folder_id": req.folder_id}

    @router.post("/{thesis_id}/contra")
    async def generate_contra(thesis_id: str, user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"]}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        if doc.get("contra"):
            # Already generated — return it directly (no job needed).
            return {"result": doc["contra"]}
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id,
            "user_id": user["user_id"],
            "kind": "contra",
            "thesis_id": thesis_id,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_contra_job(job_id, thesis_id, user["user_id"]))
        return {"job_id": job_id}

    @router.delete("/{thesis_id}")
    async def delete_thesis(thesis_id: str, user: Dict[str, Any] = Depends(auth_required)):
        res = await db.theses.delete_one({"id": thesis_id, "user_id": user["user_id"]})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        return {"ok": True}

    return router


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
    run_trend_contra, run_company_contra, run_discover,
    match_company_to_theses, evaluate_company_for_trend, compute_tam_score,
)
from services.valuation import fetch_fundamentals_sync
import fx as fx_service

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


def _discover_sync() -> dict:
    return asyncio.run(run_discover())


def _match_sync(company: str, company_trends: list, existing: list) -> dict:
    return asyncio.run(match_company_to_theses(company, company_trends, existing))


def _eval_company_sync(trend_doc: dict, ticker: str, name: str) -> dict:
    return asyncio.run(evaluate_company_for_trend(
        trend_doc.get("title") or trend_doc.get("query") or "",
        trend_doc.get("summary") or "",
        trend_doc.get("value_chain") or [],
        name, ticker,
    ))


class GenerateRequest(BaseModel):
    type: str  # "trend" | "company"
    subject: str
    matched_thesis_id: Optional[str] = None  # exclude companies already in this thesis (and its siblings)


class FolderRequest(BaseModel):
    name: str


class AssignFolderRequest(BaseModel):
    folder_id: Optional[str] = None


class AddCompanyRequest(BaseModel):
    ticker: str
    name: Optional[str] = None


class RadarSubscribeRequest(BaseModel):
    enabled: bool


class TamScoreItem(BaseModel):
    ticker: str
    overall_score: Optional[float] = None
    stage_tam_busd: Optional[float] = None


class TamScoresRequest(BaseModel):
    items: List[TamScoreItem]


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
                        "trend_exposure": c.get("trend_exposure"),
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

    async def _projected_revenue_usd_busd(ticker: str):
        """Projected 2027 revenue (revenue_2y, same base as POC/POV) converted to
        USD billions. Reuses the 6h fundamentals cache; fetches yfinance on miss.
        Returns (revenue_in_usd_billions | None, currency)."""
        tk = (ticker or "").upper().strip()
        if not tk:
            return None, "USD"
        cached = await db.fundamentals.find_one({"ticker": tk}, {"_id": 0})
        data = (cached or {}).get("data")
        if not data:
            try:
                data = await asyncio.to_thread(fetch_fundamentals_sync, tk)
                await db.fundamentals.update_one(
                    {"ticker": tk},
                    {"$set": {"ticker": tk, "data": data,
                              "updated_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True,
                )
            except Exception as e:
                logger.warning(f"tam-score revenue fetch failed ({tk}): {e}")
                return None, "USD"
        currency = data.get("currency") or "USD"
        rev2y = (data.get("auto_projections") or {}).get("revenue_2y")
        if rev2y is None:
            return None, currency
        usd = await fx_service.convert(float(rev2y), currency, "USD")
        if usd is None or usd <= 0:
            return None, currency
        return usd / 1e9, currency

    async def _run_tamscore_job(job_id: str, items: List[Dict[str, Any]]):
        try:
            scores: Dict[str, Any] = {}
            for it in items:
                tk = (it.get("ticker") or "").upper().strip()
                if not tk:
                    continue
                overall = it.get("overall_score")
                stage_tam = it.get("stage_tam_busd")
                rev_busd, currency = await _projected_revenue_usd_busd(tk)
                tam_score = compute_tam_score(overall, stage_tam, rev_busd)
                scores[tk] = {
                    "tam_score": tam_score,
                    "projected_revenue_busd": round(rev_busd, 2) if rev_busd else None,
                    "currency": currency,
                    "stage_tam_busd": stage_tam,
                }
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": {"scores": scores},
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"tam-score job failed: {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": f"Error calculando el TAM Score: {e}"}})

    async def _run_generate_job(job_id: str, kind: str, subject: str, user_id: Optional[str], matched_thesis_id: Optional[str] = None):
        try:
            thesis = await asyncio.to_thread(_generate_sync, kind, subject)

            # Anti-duplication: when generating "de todas formas" from a card that
            # matched an existing thesis, drop companies already present in that thesis
            # (or its sibling theses generated the same way) so a company is never
            # double-counted. It stays only in the thesis tied to the FIRST action.
            omitted: List[Dict[str, Any]] = []
            if user_id and kind == "trend" and matched_thesis_id and thesis.get("type") == "trend":
                covered = await db.theses.find(
                    {"user_id": user_id, "$or": [
                        {"id": matched_thesis_id},
                        {"trend_match_id": matched_thesis_id},
                    ]},
                    {"_id": 0, "companies": 1},
                ).to_list(length=300)
                covered_tickers = set()
                for cd in covered:
                    for c in (cd.get("companies") or []):
                        t = (c.get("ticker") or "").upper().strip()
                        if t:
                            covered_tickers.add(t)
                if covered_tickers:
                    kept = []
                    for c in (thesis.get("companies") or []):
                        t = (c.get("ticker") or "").upper().strip()
                        if t and t in covered_tickers:
                            omitted.append({"ticker": t, "name": c.get("name")})
                        else:
                            kept.append(c)
                    thesis["companies"] = kept
            if omitted:
                thesis["omitted_companies"] = omitted
                mt = await db.theses.find_one(
                    {"id": matched_thesis_id, "user_id": user_id}, {"_id": 0, "id": 1, "title": 1}
                )
                if mt:
                    thesis["omitted_for_thesis"] = {"id": mt.get("id"), "title": mt.get("title")}

            if user_id:
                tid = f"thesis_{uuid.uuid4().hex[:12]}"
                doc = {
                    "id": tid,
                    "user_id": user_id,
                    "folder_id": None,
                    "saved": False,
                    "trend_match_id": matched_thesis_id if (kind == "trend" and matched_thesis_id) else None,
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

    async def _run_discover_job(job_id: str):
        try:
            result = await asyncio.to_thread(_discover_sync)
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": result, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except ValueError as e:
            await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": str(e)}})
        except Exception as e:
            logger.error(f"discover failed: {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": f"Error detectando tendencias: {e}"}})

    async def _run_addcompany_job(job_id: str, thesis_id: str, user_id: str, ticker: str, name: str):
        try:
            doc = await db.theses.find_one({"id": thesis_id, "user_id": user_id, "type": "trend"}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Tesis de tendencia no encontrada"}})
                return
            entry = await asyncio.to_thread(_eval_company_sync, doc, ticker, name or ticker)
            tk = (entry.get("ticker") or "").upper().strip()
            companies = doc.get("companies") or []
            companies = [c for c in companies if (c.get("ticker") or "").upper() != tk]  # de-dupe
            companies.append(entry)
            await db.theses.update_one({"id": thesis_id, "user_id": user_id}, {"$set": {"companies": companies}})
            # Index by ticker for the qualitative bridge.
            await db.qual_snapshots.update_one(
                {"user_id": user_id, "ticker": tk},
                {"$set": {
                    "user_id": user_id, "ticker": tk, "name": entry.get("name"),
                    "trend": doc.get("title"), "value_chain_role": entry.get("value_chain_role"),
                    "scores": entry.get("scores"), "trend_exposure": entry.get("trend_exposure"),
                    "overall_score": entry.get("overall_score"),
                    "thesis": entry.get("thesis"), "key_risks": entry.get("key_risks"),
                    "thesis_id": thesis_id, "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": {"thesis_id": thesis_id, "thesis_title": doc.get("title"), "company": entry},
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"add-company failed ({thesis_id}/{ticker}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": f"Error añadiendo la empresa: {e}"}})

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
        _spawn(_run_generate_job(job_id, kind, subject, user["user_id"] if user else None, req.matched_thesis_id))
        return {"job_id": job_id}

    @router.post("/discover")
    async def discover(user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id,
            "user_id": user["user_id"] if user else None,
            "kind": "discover",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_discover_job(job_id))
        return {"job_id": job_id}

    @router.post("/tam-scores")
    async def tam_scores(req: TamScoresRequest, user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        """Stateless TAM-Score computation (works anonymously). For each company
        returns: (overall_score/100 × stage_TAM_busd) / projected_revenue_2027_USD_billions.
        Runs as a background job because it may hit yfinance for several tickers."""
        items = [it.model_dump() for it in (req.items or []) if (it.ticker or "").strip()]
        if not items:
            raise HTTPException(status_code=400, detail="items requerido")
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id,
            "user_id": user["user_id"] if user else None,
            "kind": "tam_scores",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_tamscore_job(job_id, items))
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

    @router.get("/company/{ticker}/profile")
    async def company_profile(ticker: str, user: Dict[str, Any] = Depends(auth_required)):
        """All saved TREND theses where this ticker appears, each with its
        'score global tendencia' (overall_score) and TAM Score, plus aggregates:
        average overall_score (overall quality) and sum of TAM Scores (potential)."""
        tk = ticker.upper().strip()
        cur = db.theses.find(
            {"user_id": user["user_id"], "type": "trend", "companies.ticker": tk},
            {"_id": 0, "id": 1, "title": 1, "companies": 1, "value_chain": 1},
        )
        theses = await cur.to_list(length=500)
        rev_busd, currency = await _projected_revenue_usd_busd(tk)

        rows = []
        for t in theses:
            comp = next((c for c in (t.get("companies") or []) if (c.get("ticker") or "").upper() == tk), None)
            if not comp:
                continue
            overall = comp.get("overall_score")
            role = comp.get("value_chain_role")
            nrole = (role or "").strip().lower()
            stage_tam = None
            for s in (t.get("value_chain") or []):
                if (s.get("stage") or "").strip().lower() == nrole:
                    stage_tam = s.get("tam_busd")
                    break
            rows.append({
                "thesis_id": t.get("id"),
                "thesis_title": t.get("title"),
                "overall_score": overall,
                "value_chain_role": role,
                "tam_score": compute_tam_score(overall, stage_tam, rev_busd),
            })
        rows.sort(key=lambda r: (r["overall_score"] is None, -(r["overall_score"] or 0)))

        overalls = [r["overall_score"] for r in rows if r["overall_score"] is not None]
        tams = [r["tam_score"] for r in rows if r["tam_score"] is not None]
        avg_overall = round(sum(overalls) / len(overalls), 1) if overalls else None
        sum_tam = round(sum(tams), 2) if tams else None

        rev_doc = await db.theses.find_one(
            {"user_id": user["user_id"], "type": "company", "company.ticker": tk},
            {"_id": 0, "id": 1, "title": 1, "overall_relevance": 1},
            sort=[("created_at", -1)],
        )
        reverse = None
        if rev_doc:
            reverse = {
                "thesis_id": rev_doc.get("id"),
                "thesis_title": rev_doc.get("title"),
                "overall_relevance": rev_doc.get("overall_relevance"),
            }

        return {
            "ticker": tk,
            "projected_revenue_busd": round(rev_busd, 2) if rev_busd else None,
            "currency": currency,
            "trend_rows": rows,
            "avg_overall_score": avg_overall,
            "sum_tam_score": sum_tam,
            "reverse": reverse,
        }

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

    @router.post("/{thesis_id}/link-suggestions")
    async def link_suggestions(thesis_id: str, refresh: bool = False, user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        company = (doc.get("company") or {}).get("name") or doc.get("title") or doc.get("query")
        company_trends = [t.get("name") for t in (doc.get("trends") or []) if t.get("name")]
        if not company_trends:
            return {"to_add": [], "to_create": []}
        existing = await db.theses.find(
            {"user_id": user["user_id"], "type": "trend"}, {"_id": 0, "id": 1, "title": 1}
        ).to_list(length=300)
        # Cache keyed on the set of existing trend theses → recompute only when it
        # changes (avoids repeating the LLM matcher cost on every page load/refresh).
        sig = sorted([e.get("id") for e in existing if e.get("id")])
        cached = doc.get("link_matches")
        if not refresh and cached and cached.get("sig") == sig and cached.get("v") == 2:
            result = {"to_add": list(cached.get("to_add", [])), "to_create": cached.get("to_create", [])}
        else:
            if not existing:
                result = {"to_add": [], "to_create": [{"trend_name": tn, "why": ""} for tn in company_trends]}
            else:
                try:
                    result = await asyncio.to_thread(_match_sync, company, company_trends, existing)
                except Exception as e:
                    logger.error(f"link-suggestions failed ({thesis_id}): {e}")
                    raise HTTPException(status_code=502, detail="No se pudieron calcular las sugerencias.")
            await db.theses.update_one(
                {"id": thesis_id, "user_id": user["user_id"]},
                {"$set": {"link_matches": {
                    "v": 2,
                    "sig": sig,
                    "to_add": result.get("to_add", []),
                    "to_create": result.get("to_create", []),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }}},
            )

        # Flag whether the company is ALREADY "covered" by each matched thesis — i.e.
        # present in that thesis OR in any sibling thesis generated "de todas formas"
        # from it (trend_match_id). Computed fresh (membership changes over time). The
        # UI uses this to show either the "add to thesis" button or an "already there"
        # notice, guaranteeing the company lives in only ONE thesis per trend.
        to_add = result.get("to_add", [])
        ticker = ((doc.get("company") or {}).get("ticker") or "").upper().strip()
        ids = [a.get("thesis_id") for a in to_add if a.get("thesis_id")]
        membership: Dict[str, bool] = {}
        if ticker and ids:
            covered_docs = await db.theses.find(
                {"user_id": user["user_id"], "$or": [
                    {"id": {"$in": ids}},
                    {"trend_match_id": {"$in": ids}},
                ]},
                {"_id": 0, "id": 1, "trend_match_id": 1, "companies": 1},
            ).to_list(length=400)
            covered: Dict[str, set] = {i: set() for i in ids}
            for td in covered_docs:
                tickers = {(c.get("ticker") or "").upper() for c in (td.get("companies") or [])}
                key = td.get("id") if td.get("id") in covered else td.get("trend_match_id")
                if key in covered:
                    covered[key].update(tickers)
            for i in ids:
                membership[i] = ticker in covered.get(i, set())
        for a in to_add:
            a["already_in"] = bool(membership.get(a.get("thesis_id"), False))
        return result

    @router.post("/{thesis_id}/add-company")
    async def add_company(thesis_id: str, req: AddCompanyRequest, user: Dict[str, Any] = Depends(auth_required)):
        ticker = (req.ticker or "").upper().strip()
        if not ticker:
            raise HTTPException(status_code=400, detail="ticker requerido")
        exists = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"], "type": "trend"}, {"_id": 0, "id": 1})
        if not exists:
            raise HTTPException(status_code=404, detail="Tesis de tendencia no encontrada")
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id, "user_id": user["user_id"], "kind": "add_company",
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_addcompany_job(job_id, thesis_id, user["user_id"], ticker, req.name or ticker))
        return {"job_id": job_id}

    @router.get("/radar/status")
    async def radar_status(user: Dict[str, Any] = Depends(auth_required)):
        u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "radar": 1})
        return {"enabled": bool(((u or {}).get("radar") or {}).get("enabled"))}

    @router.post("/radar/subscribe")
    async def radar_subscribe(req: RadarSubscribeRequest, user: Dict[str, Any] = Depends(auth_required)):
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"radar": {"enabled": bool(req.enabled), "updated_at": datetime.now(timezone.utc).isoformat()}}},
        )
        return {"enabled": bool(req.enabled)}

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


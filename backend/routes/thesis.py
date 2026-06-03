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


def _fmt_val(v):
    return v if v is not None else "—"


def _score_far(a, b, tol):
    """True if two scores differ by more than `tol` (or one is missing and not both)."""
    if a is None and b is None:
        return False
    if a is None or b is None:
        return True
    try:
        return abs(float(a) - float(b)) > tol
    except (TypeError, ValueError):
        return a != b


def _company_thesis_changes(old: dict, new: dict) -> list:
    """Human-readable changes (Spanish) between a saved company thesis and a freshly
    regenerated one. Trends are paired by token overlap (Jaccard ≥ 0.5) so a reworded
    name isn't seen as new+removed. Empty list = practically identical (no novelty)."""
    changes = []
    if _score_far(old.get("overall_relevance"), new.get("overall_relevance"), 6):
        changes.append(f"Relevancia temática global: {_fmt_val(old.get('overall_relevance'))} → {_fmt_val(new.get('overall_relevance'))}")
    if _score_far(old.get("probability"), new.get("probability"), 1):
        changes.append(f"Probabilidad de la tesis: {_fmt_val(old.get('probability'))} → {_fmt_val(new.get('probability'))}")
    old_tr = list(old.get("trends") or [])
    new_tr = list(new.get("trends") or [])
    used = set()
    for nt in new_tr:
        na = set((nt.get("name") or "").lower().split())
        best_j, best_score = None, 0.0
        for j, ot in enumerate(old_tr):
            if j in used:
                continue
            ob = set((ot.get("name") or "").lower().split())
            union = len(na | ob)
            score = (len(na & ob) / union) if union else 0.0
            if score > best_score:
                best_j, best_score = j, score
        if best_j is not None and best_score >= 0.5:
            used.add(best_j)
            ot = old_tr[best_j]
            name = nt.get("name")
            if _score_far(ot.get("relevance_score"), nt.get("relevance_score"), 6):
                changes.append(f"Relevancia de «{name}»: {_fmt_val(ot.get('relevance_score'))} → {_fmt_val(nt.get('relevance_score'))}")
            if _score_far(ot.get("win_probability"), nt.get("win_probability"), 1):
                changes.append(f"Probabilidad ganadora de «{name}»: {_fmt_val(ot.get('win_probability'))} → {_fmt_val(nt.get('win_probability'))}")
        else:
            changes.append(f"Nueva tendencia: {nt.get('name')}")
    for j, ot in enumerate(old_tr):
        if j not in used:
            changes.append(f"Tendencia eliminada: {ot.get('name')}")
    return changes


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
    overwrite_thesis_id: Optional[str] = None  # update this saved thesis in place instead of inserting a new one


class FolderRequest(BaseModel):
    name: str


class AssignFolderRequest(BaseModel):
    folder_id: Optional[str] = None


class RestoreRequest(BaseModel):
    folders: Optional[List[Dict[str, Any]]] = None
    theses: Optional[List[Dict[str, Any]]] = None
    reassign: Optional[List[Dict[str, Any]]] = None  # [{id, folder_id}]


class AddCompanyRequest(BaseModel):
    ticker: str
    name: Optional[str] = None
    entry: Optional[Dict[str, Any]] = None  # precomputed evaluation (from /evaluate-company) → skip LLM


class EvaluateCompanyRequest(BaseModel):
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

    async def _run_generate_job(job_id: str, kind: str, subject: str, user_id: Optional[str], matched_thesis_id: Optional[str] = None, overwrite_thesis_id: Optional[str] = None):
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
                # Overwrite an existing saved thesis in place (dedup: avoids a second
                # card for the same trend/company; weekly auto-refresh keeps it fresh).
                existing = None
                if overwrite_thesis_id:
                    existing = await db.theses.find_one(
                        {"id": overwrite_thesis_id, "user_id": user_id}, {"_id": 0}
                    )
                if existing:
                    tid = existing["id"]
                    # Novelty check (company regen): if the new analysis is practically
                    # identical to the saved one, KEEP the existing thesis and inform the
                    # user instead of overwriting with the same content.
                    changes = _company_thesis_changes(existing, thesis) if kind == "company" else None
                    if changes is not None and not changes:
                        kept = {k: v for k, v in existing.items() if k != "user_id"}
                        kept["id"] = tid
                        kept["saved"] = True
                        kept["no_changes"] = True
                        await db.thesis_jobs.update_one(
                            {"id": job_id},
                            {"$set": {"status": "done", "result": kept,
                                      "updated_at": datetime.now(timezone.utc).isoformat()}},
                        )
                        return
                    await db.theses.update_one(
                        {"id": tid, "user_id": user_id},
                        {"$set": {**thesis, "updated_at": datetime.now(timezone.utc).isoformat()}},
                    )
                    await _persist_qual_snapshots(user_id, tid, thesis)
                    thesis["id"] = tid
                    thesis["saved"] = True
                    if changes:
                        thesis["changes"] = changes  # result-only (not persisted)
                else:
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

    async def _run_addcompany_job(job_id: str, thesis_id: str, user_id: str, ticker: str, name: str, precomputed: Optional[dict] = None):
        try:
            doc = await db.theses.find_one({"id": thesis_id, "user_id": user_id, "type": "trend"}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Tesis de tendencia no encontrada"}})
                return
            # Reuse the score preview computed by /evaluate-company (no second LLM call).
            if precomputed and (precomputed.get("ticker") or "").upper().strip() == ticker:
                entry = precomputed
            else:
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

    async def _run_eval_company_job(job_id: str, thesis_id: str, user_id: str, ticker: str, name: str):
        """Score PREVIEW: evaluate the company inside the trend (LLM) WITHOUT persisting,
        returning both the 'Score global tendencia' (overall_score) and the TAM Score so
        the user can decide before confirming the add."""
        try:
            doc = await db.theses.find_one({"id": thesis_id, "user_id": user_id, "type": "trend"}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Tesis de tendencia no encontrada"}})
                return
            entry = await asyncio.to_thread(_eval_company_sync, doc, ticker, name or ticker)
            role = (entry.get("value_chain_role") or "").strip().lower()
            stage_tam = None
            for s in (doc.get("value_chain") or []):
                if (s.get("stage") or "").strip().lower() == role:
                    stage_tam = s.get("tam_busd")
                    break
            rev_busd, currency = await _projected_revenue_usd_busd(ticker)
            tam_score = compute_tam_score(entry.get("overall_score"), stage_tam, rev_busd)
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": {
                    "entry": entry,
                    "overall_score": entry.get("overall_score"),
                    "tam_score": tam_score,
                    "stage_tam_busd": stage_tam,
                    "projected_revenue_busd": round(rev_busd, 2) if rev_busd else None,
                    "currency": currency,
                    "thesis_title": doc.get("title"),
                }, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"evaluate-company failed ({thesis_id}/{ticker}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": f"Error calculando el score: {e}"}})

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
        _spawn(_run_generate_job(job_id, kind, subject, user["user_id"] if user else None, req.matched_thesis_id, req.overwrite_thesis_id))
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
    async def delete_folder(folder_id: str, mode: str = "ungroup", user: Dict[str, Any] = Depends(auth_required)):
        """mode='ungroup' (default): detach theses (keep them). mode='cascade':
        also delete the contained theses. Returns the removed data so the client
        can offer Undo."""
        uid = user["user_id"]
        folder = await db.thesis_folders.find_one({"id": folder_id, "user_id": uid}, {"_id": 0})
        if not folder:
            raise HTTPException(status_code=404, detail="Megatendencia no encontrada")
        await db.thesis_folders.delete_one({"id": folder_id, "user_id": uid})
        if mode == "cascade":
            deleted = await db.theses.find(
                {"user_id": uid, "folder_id": folder_id}, {"_id": 0}
            ).to_list(length=500)
            await db.theses.delete_many({"user_id": uid, "folder_id": folder_id})
            return {"ok": True, "mode": "cascade", "folder": folder, "deleted_theses": deleted}
        affected = await db.theses.find(
            {"user_id": uid, "folder_id": folder_id}, {"_id": 0, "id": 1}
        ).to_list(length=500)
        await db.theses.update_many(
            {"user_id": uid, "folder_id": folder_id}, {"$set": {"folder_id": None}},
        )
        return {"ok": True, "mode": "ungroup", "folder": folder,
                "detached_ids": [a["id"] for a in affected]}

    @router.post("/restore")
    async def restore(req: RestoreRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Generic restore used by Undo/Redo: re-insert folders/theses (by id) and
        reassign folder_id. Idempotent (upsert)."""
        uid = user["user_id"]
        for f in (req.folders or []):
            f = {k: v for k, v in f.items() if k != "_id"}
            f["user_id"] = uid
            await db.thesis_folders.update_one({"id": f["id"], "user_id": uid}, {"$set": f}, upsert=True)
        for t in (req.theses or []):
            t = {k: v for k, v in t.items() if k != "_id"}
            t["user_id"] = uid
            await db.theses.update_one({"id": t["id"], "user_id": uid}, {"$set": t}, upsert=True)
        for r in (req.reassign or []):
            if r.get("id"):
                await db.theses.update_one(
                    {"id": r["id"], "user_id": uid}, {"$set": {"folder_id": r.get("folder_id")}})
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

    @router.get("/dashboard")
    async def dashboard(user: Dict[str, Any] = Depends(auth_required)):
        """Aggregated data backbone for the Thesis dashboard (sidebar + treemaps):
        - folders (megatendencias) with TAM = sum of contained trends' global TAM
        - trends with TAM + their companies (each with overall_score + TAM Score)
        - companies (distinct) with avg overall_score, sum TAM Score, trend memberships
        TAM Score uses ONLY the cached fundamentals (no live yfinance fetch → fast/cheap)."""
        uid = user["user_id"]
        trend_docs = await db.theses.find(
            {"user_id": uid, "type": "trend"},
            {"_id": 0, "id": 1, "title": 1, "folder_id": 1, "tam": 1,
             "value_chain": 1, "companies": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=1000)
        company_docs = await db.theses.find(
            {"user_id": uid, "type": "company"},
            {"_id": 0, "id": 1, "title": 1, "folder_id": 1, "company": 1,
             "overall_relevance": 1, "trends": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=1000)
        folders = await db.thesis_folders.find(
            {"user_id": uid}, {"_id": 0}
        ).sort("created_at", -1).to_list(length=200)

        # Bulk projected-revenue map (USD billions) from the fundamentals cache only.
        tickers = set()
        for t in trend_docs:
            for c in (t.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                if tk:
                    tickers.add(tk)
        rev_map: Dict[str, float] = {}
        if tickers:
            cached = await db.fundamentals.find(
                {"ticker": {"$in": list(tickers)}}, {"_id": 0, "ticker": 1, "data": 1}
            ).to_list(length=2000)
            for cd in cached:
                data = cd.get("data") or {}
                rev2y = (data.get("auto_projections") or {}).get("revenue_2y")
                if rev2y is None:
                    continue
                currency = data.get("currency") or "USD"
                usd = await fx_service.convert(float(rev2y), currency, "USD")
                if usd and usd > 0:
                    rev_map[cd.get("ticker")] = usd / 1e9

        trends: List[Dict[str, Any]] = []
        comp_agg: Dict[str, Dict[str, Any]] = {}
        for t in trend_docs:
            stage_tam: Dict[str, Any] = {}
            for s in (t.get("value_chain") or []):
                stage_tam[(s.get("stage") or "").strip().lower()] = s.get("tam_busd")
            clist = []
            for c in (t.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                overall = c.get("overall_score")
                role = (c.get("value_chain_role") or "").strip().lower()
                tam_score = compute_tam_score(overall, stage_tam.get(role), rev_map.get(tk))
                clist.append({
                    "ticker": tk or None, "name": c.get("name"), "overall_score": overall,
                    "value_chain_role": c.get("value_chain_role"),
                    "tam_score": tam_score, "category": c.get("category"),
                })
                if tk:
                    a = comp_agg.setdefault(tk, {"ticker": tk, "name": c.get("name"),
                                                 "scores": [], "tams": [], "trends": []})
                    a["name"] = a["name"] or c.get("name")
                    if overall is not None:
                        a["scores"].append(overall)
                    if tam_score is not None:
                        a["tams"].append(tam_score)
                    a["trends"].append({"thesis_id": t.get("id"), "title": t.get("title"),
                                        "overall_score": overall, "tam_score": tam_score})
            trends.append({
                "id": t.get("id"), "title": t.get("title"), "folder_id": t.get("folder_id"),
                "tam_busd": (t.get("tam") or {}).get("global_busd"),
                "company_count": len(clist), "companies": clist,
            })

        companies = []
        for tk, a in comp_agg.items():
            avg = round(sum(a["scores"]) / len(a["scores"]), 1) if a["scores"] else None
            stam = round(sum(a["tams"]), 2) if a["tams"] else None
            companies.append({
                "ticker": tk, "name": a["name"], "avg_overall_score": avg,
                "sum_tam_score": stam, "trends": a["trends"], "trend_count": len(a["trends"]),
            })
        companies.sort(key=lambda c: (c["avg_overall_score"] is None, -(c["avg_overall_score"] or 0)))

        folder_out = []
        for f in folders:
            contained = [tr for tr in trends if tr["folder_id"] == f.get("id")]
            ftam = sum((tr["tam_busd"] or 0) for tr in contained)
            folder_out.append({
                "id": f.get("id"), "name": f.get("name"),
                "tam_busd": round(ftam, 1) if ftam else None,
                "trend_ids": [tr["id"] for tr in contained],
                "trend_count": len(contained),
            })

        # Company dropdown (simplified): list ONLY the trend theses already generated
        # where the company really appears (membership). Newest doc per ticker. The
        # list reflects live membership, so adding a company to an existing thesis
        # shows up on the next dashboard reload (page change or the Refresh button).
        trend_tickers = {
            tr["id"]: {(c.get("ticker") or "").upper() for c in tr["companies"] if c.get("ticker")}
            for tr in trends
        }
        company_theses = []
        seen_tickers = set()
        for d in company_docs:  # sorted newest-first → keep only the latest per ticker
            tk = ((d.get("company") or {}).get("ticker") or "").upper().strip()
            if tk and tk in seen_tickers:
                continue
            if tk:
                seen_tickers.add(tk)
            fit = [
                {"name": tr["title"], "thesis_id": tr["id"], "state": "included"}
                for tr in trends
                if tk and tk in trend_tickers.get(tr["id"], set())
            ]
            company_theses.append({
                "id": d.get("id"), "title": d.get("title"), "folder_id": d.get("folder_id"),
                "ticker": tk or None, "overall_relevance": d.get("overall_relevance"),
                "fit_trends": fit,
            })

        return {"folders": folder_out, "trends": trends,
                "companies": companies, "company_theses": company_theses}

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

    @router.post("/{thesis_id}/evaluate-company")
    async def evaluate_company(thesis_id: str, req: EvaluateCompanyRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Score preview (job): evaluates the company in this trend without saving it.
        Returns overall_score + TAM Score so the UI can show both before confirming."""
        ticker = (req.ticker or "").upper().strip()
        if not ticker:
            raise HTTPException(status_code=400, detail="ticker requerido")
        exists = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"], "type": "trend"}, {"_id": 0, "id": 1})
        if not exists:
            raise HTTPException(status_code=404, detail="Tesis de tendencia no encontrada")
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id, "user_id": user["user_id"], "kind": "evaluate_company",
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_eval_company_job(job_id, thesis_id, user["user_id"], ticker, req.name or ticker))
        return {"job_id": job_id}

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
        _spawn(_run_addcompany_job(job_id, thesis_id, user["user_id"], ticker, req.name or ticker, req.entry))
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

    @router.get("/refresh/status")
    async def refresh_status(user: Dict[str, Any] = Depends(auth_required)):
        u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "thesis_refresh": 1})
        return {"enabled": bool(((u or {}).get("thesis_refresh") or {}).get("enabled"))}

    @router.post("/refresh/subscribe")
    async def refresh_subscribe(req: RadarSubscribeRequest, user: Dict[str, Any] = Depends(auth_required)):
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"thesis_refresh": {"enabled": bool(req.enabled), "updated_at": datetime.now(timezone.utc).isoformat()}}},
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


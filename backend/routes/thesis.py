"""Thesis Engine routes — qualitative AI module.

Generation works for anyone (anonymous gets an ephemeral result). Saving to
folders, listing and the per-company qualitative view require Google login,
reusing the existing auth dependencies from auth.py.
"""
import uuid
import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response, Query, Header, Cookie
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorDatabase

from services.thesis import (
    gather_sources, run_trend_thesis, run_company_thesis,
    run_trend_contra, run_company_contra, run_discover,
    run_trend_explore, run_auto_trend, run_costed,
    match_company_to_theses, compute_tam_score,
    stage_tam_for_role, effective_stage_tam,
    detect_parent_thesis, aggregate_folder_tam,
    MODEL_PRESETS, get_model_preset, set_model_preset,
)
from services.valuation import fetch_fundamentals_sync, compute_custom_ratios
from services.kpi import gather_kpi_sources, run_company_kpis, run_company_kpis_incremental, compute_kpi_coefficients, gather_kpi_search_sources, run_kpi_search, extract_document_text, extract_document_text_from_text, extract_pdf_text_local, gather_news_sources, gather_news_search_sources, run_company_news, prune_news, merge_prune_news
from services.fetcher import fetch_full_sources
from services.sec import fetch_latest_sec_report
from storage import put_object, get_object, APP_NAME, MIME_TYPES
from thesis_refresh import refresh_user_data, recompute_and_store_tam
import fx as fx_service

logger = logging.getLogger(__name__)

# Keep strong references to background tasks so they are not garbage-collected.
_BG_TASKS: set = set()


def _fmt_val(v):
    return v if v is not None else "—"


def prune_stale_split_dev(split_dev, alive_ids):
    """Keep only split_dev entries whose developed thesis still exists. When a
    developed (sub)thesis is deleted, its entry is dropped here so the origin
    company suggestions page shows that core/split as 'pendiente' again (and it
    can be regenerated). Idempotent and order-preserving."""
    alive = set(alive_ids or [])
    return [e for e in (split_dev or []) if e.get("developed_id") in alive]


def company_is_complete(doc) -> bool:
    """A company thesis is 'complete' when planning is locked (has split_dev) AND every
    non-merged driver has been fully developed (whole developed, or — if planned as
    'split' — all its partitions developed). Used to decide which companies surface in
    the dashboard treemap (only fully-planned, fully-developed ones)."""
    def _n(s):
        return (s or "").strip().lower()
    dev = doc.get("split_dev") or []
    if not dev:
        return False
    whole_done = {_n(e.get("core")) for e in dev if e.get("whole")}
    split_done = {(_n(e.get("core")), _n(e.get("split"))) for e in dev if not e.get("whole") and e.get("split")}
    for drv in (doc.get("trends") or []):
        if drv.get("merged_into"):
            continue
        name = _n(drv.get("name"))
        splits = drv.get("splits") or []
        if drv.get("plan") == "split" and splits:
            for sp in splits:
                if (name, _n(sp.get("name"))) not in split_done:
                    return False
        elif name not in whole_done:
            return False
    return True


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


def _friendly_err(e) -> str:
    """Map common LLM-provider failures to a clear Spanish message for the UI."""
    msg = str(e)
    low = msg.lower()
    if "budget has been exceeded" in low or "max budget" in low or "insufficient_quota" in low or "exceeded your current quota" in low:
        return ("Se ha agotado el saldo de la clave de IA (Emergent LLM Key). "
                "Recárgalo en Profile → Universal Key → Add Balance (o activa el auto top-up) y vuelve a intentarlo.")
    if "rate limit" in low or "too many requests" in low or "429" in low:
        return "El proveedor de IA está saturado ahora mismo (límite de peticiones). Espera unos segundos y vuelve a intentarlo."
    if "timeout" in low or "timed out" in low:
        return "La generación tardó demasiado (timeout). Vuelve a intentarlo en un momento."
    return ""



def _generate_sync(kind: str, subject: str, origin_company: Optional[str] = None, existing_theses: Optional[list] = None) -> dict:
    """Run the full (blocking) generation pipeline in a worker thread.

    emergentintegrations' LLM calls are synchronous and would otherwise block the
    main event loop for ~1 min, freezing job-status polling. We run the whole
    async pipeline inside its own event loop in a thread (via asyncio.to_thread).
    """
    sources = gather_sources(subject, kind)
    coro = run_trend_thesis(subject, sources, origin_company) if kind == "trend" else run_company_thesis(subject, sources, existing_theses)
    result, cost = run_costed(coro)
    result["_cost"] = cost
    return result


def _contra_sync(doc: dict) -> dict:
    if doc.get("type") == "company":
        name = (doc.get("company") or {}).get("name") or doc.get("title") or doc.get("query")
        coro = run_company_contra(name, doc.get("summary") or "")
    else:
        coro = run_trend_contra(doc.get("title") or doc.get("query"), doc.get("summary") or "")
    result, cost = run_costed(coro)
    if isinstance(result, dict):
        result["_cost"] = cost
    return result


def _discover_sync() -> dict:
    return asyncio.run(run_discover())


def _explore_sync(subject: str) -> dict:
    sources = gather_sources(subject, "trend")
    result, cost = run_costed(run_trend_explore(subject, sources))
    result["_cost"] = cost
    return result


def _auto_trend_sync(exclude) -> dict:
    result, cost = run_costed(run_auto_trend(exclude or []))
    result["_cost"] = cost
    return result


def _kpi_sync(company: str, ticker: str, drivers: list, docs: list = None, context_news: list = None, web_sources: list = None) -> dict:
    """Blocking KPI pipeline (live search + selected document digests + LLM).
    If `web_sources` is provided (Option A: full-content fetch), it replaces the
    internal snippet-only search."""
    sources = web_sources if web_sources is not None else gather_kpi_sources(company, ticker)
    if docs:
        sources = sources + docs
    result, cost = run_costed(run_company_kpis(company, ticker, drivers, sources, context_news))
    if isinstance(result, dict):
        result["_cost"] = cost
    return result


def _kpi_incremental_sync(company: str, ticker: str, drivers: list, existing_kpis: list,
                          new_docs: list = None, context_news: list = None,
                          listing_sources: list = None, period: str = None) -> dict:
    """Blocking incremental KPI update (re-judge existing + extract only new docs)."""
    result, cost = run_costed(run_company_kpis_incremental(
        company, ticker, drivers, existing_kpis, new_docs, context_news, listing_sources, period))
    if isinstance(result, dict):
        result["_cost"] = cost
    return result


def _news_sync(company: str, ticker: str, drivers: list, query: str = None) -> list:
    """Blocking news extraction (live search + Gemini) in a worker thread."""
    if query:
        sources = gather_news_search_sources(company, ticker, query)
    else:
        sources = gather_news_sources(company, ticker)
    result, _cost = run_costed(run_company_news(company, ticker, drivers, sources))
    return result if isinstance(result, list) else []


def _kpi_search_sync(company: str, ticker: str, drivers: list, query: str, docs: list = None) -> dict:
    """Blocking targeted single-KPI search (live search + document digests + LLM)."""
    sources = gather_kpi_search_sources(company, ticker, query)
    if docs:
        sources = sources + docs
    result, _cost = run_costed(run_kpi_search(company, ticker, drivers, query, sources))
    if isinstance(result, dict):
        result["_sources"] = [{"title": s.get("title"), "url": s.get("url")} for s in sources][:12]
    return result


def _selected_doc_sources(files: list) -> list:
    """Turn selected, ready KPI files into text 'sources' the extractor can cite."""
    out = []
    for f in files:
        txt = (f.get("extracted_text") or "").strip()
        if not txt:
            continue
        out.append({
            "title": f"[Documento] {f.get('original_filename') or 'archivo'}",
            "url": f"doc:{f.get('id')}",
            "snippet": txt[:9000],
        })
    return out


KPI_MAX_FILES = 10
KPI_MAX_BYTES = 100 * 1024 * 1024  # 100 MB
KPI_ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg", "webp", "gif"}

_PERIOD_RE = re.compile(r"\b(q[1-4]|fy\s?\d{2,4}|h[12]|1h|2h|20\d{2}|19\d{2})\b", re.I)
_DOC_STOP = {"the", "de", "del", "la", "el", "los", "las", "un", "una", "y", "and",
             "of", "for", "inc", "corp", "pdf", "a"}


def _doc_family(name: str) -> set:
    """Normalised 'kind' of a document: its title minus any period/date tokens.
    Two docs with the same family (e.g. quarterly results decks) are equivalent."""
    s = (name or "").lower()
    s = _PERIOD_RE.sub(" ", s)
    s = re.sub(r"[^a-záéíóúñ ]", " ", s)
    return {t for t in s.split() if len(t) > 2 and t not in _DOC_STOP}


def _period_rank(name: str) -> int:
    """Sortable recency of a document from its title (year*4 + quarter). 0 = unknown."""
    s = (name or "").lower()
    year = 0
    m = re.search(r"(20\d{2})", s)
    if m:
        year = int(m.group(1))
    q = 0
    mq = re.search(r"q([1-4])", s)
    if mq:
        q = int(mq.group(1))
    elif re.search(r"\bh2\b|\b2h\b", s):
        q = 4
    elif re.search(r"\bh1\b|\b1h\b", s):
        q = 2
    return year * 4 + q


def _split_doc_title(raw: str) -> dict:
    """Split the extractor output into the suggested TÍTULO (first line) + KPI digest."""
    raw = (raw or "").strip()
    title, body = None, raw
    lines = raw.splitlines()
    if lines:
        first = lines[0].strip().lstrip("*# ").strip()
        norm = first.upper().replace("Í", "I")
        if norm.startswith("TITULO:"):
            title = first.split(":", 1)[1].strip().strip("*").strip()[:120]
            body = "\n".join(lines[1:]).strip()
    return {"title": title or None, "text": body}


def _doc_extract_sync(data: bytes, ext: str, mime: str, company: str, filename: str) -> dict:
    """Extract an operational-KPI digest from an uploaded PDF/image.

    Strategy: for TEXT-BASED PDFs, extract text locally with pypdf (fast, no vision
    cost) and digest it with a cheap Gemini text call. Only image-heavy/scanned PDFs
    and images fall back to the multimodal reader (with retries)."""
    import tempfile
    if ext == "pdf":
        local_text = extract_pdf_text_local(data)
        if local_text and len(local_text) >= 200:
            raw, _cost = run_costed(extract_document_text_from_text(local_text, company, filename))
            return _split_doc_title(raw)
    # Fallback: multimodal vision read (images, scanned/graphic PDFs).
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tf:
        tf.write(data)
        path = tf.name
    try:
        raw, _cost = run_costed(extract_document_text(path, mime, company, filename))
        return _split_doc_title(raw)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _company_drivers(doc: dict) -> list:
    """Growth-driver theses of a company doc (non-merged), as the KPI judge input."""
    out = []
    for t in (doc.get("trends") or []):
        if t.get("merged_into"):
            continue
        out.append({
            "name": t.get("name"),
            "type": t.get("type"),
            "demand_driver": t.get("demand_driver"),
            "fit_description": t.get("fit_description"),
            "tam_busd": t.get("tam_busd"),
        })
    return out


def _match_sync(company: str, company_trends: list, existing: list) -> dict:
    return asyncio.run(match_company_to_theses(company, company_trends, existing))


def _detect_parent_sync(new_title: str, new_summary: str, new_tam, existing: list) -> dict:
    return asyncio.run(detect_parent_thesis(new_title, new_summary, new_tam, existing))


class GenerateRequest(BaseModel):
    type: str  # "trend" | "company"
    subject: str
    matched_thesis_id: Optional[str] = None  # exclude companies already in this thesis (and its siblings)
    overwrite_thesis_id: Optional[str] = None  # update this saved thesis in place instead of inserting a new one
    from_company: Optional[str] = None  # company thesis id this trend is being developed FROM (a core/split)
    core: Optional[str] = None  # the core thesis name this trend was split out of
    develop_whole: bool = False  # True when developing the whole core (vs a single split)
    queue: bool = False  # if a generation is already running, queue this one instead of rejecting


class FolderRequest(BaseModel):
    name: str


class AssignFolderRequest(BaseModel):
    folder_id: Optional[str] = None


class AssignParentRequest(BaseModel):
    parent_id: Optional[str] = None


class SplitDevelopedRequest(BaseModel):
    core: str
    split: Optional[str] = None
    developed_id: str
    whole: bool = False


class RestoreRequest(BaseModel):
    folders: Optional[List[Dict[str, Any]]] = None
    theses: Optional[List[Dict[str, Any]]] = None
    reassign: Optional[List[Dict[str, Any]]] = None  # [{id, folder_id}]


class RadarSubscribeRequest(BaseModel):
    enabled: bool
    weekday: Optional[int] = None     # 0=Mon … 6=Sun, UTC. None → keep stored / default 0.
    hour_utc: Optional[int] = None    # 0-23. None → keep stored / default 7.

class RefreshRunRequest(BaseModel):
    thesis_id: Optional[str] = None   # refresh this thesis (trend) or company thesis
    ticker: Optional[str] = None      # refresh this company across all its theses

class SetPlanRequest(BaseModel):
    core: str            # driver name
    plan: str            # "whole" | "split"

class TamScoreItem(BaseModel):
    ticker: str
    overall_score: Optional[float] = None
    stage_tam_busd: Optional[float] = None


class TamScoresRequest(BaseModel):
    items: List[TamScoreItem]


class ExploreRequest(BaseModel):
    subject: str


class AutoTrendRequest(BaseModel):
    exclude: Optional[List[str]] = None


class EditKpisRequest(BaseModel):
    kpis: List[Dict[str, Any]]


class KpiSearchRequest(BaseModel):
    query: str


class KpiTranscriptRequest(BaseModel):
    text: str
    title: Optional[str] = None


class KpiFileSelectRequest(BaseModel):
    selected: Optional[bool] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    dismiss_supersedes: Optional[bool] = None


class KpiNewsRequest(BaseModel):
    query: Optional[str] = None


class SaveTendenciaRequest(BaseModel):
    tendencia: Dict[str, Any]
    overwrite_id: Optional[str] = None  # if set: delete the existing tendencia first (machacar)


class SetModelRequest(BaseModel):
    preset: str


class MergeThesisRequest(BaseModel):
    source: str
    target: str


class UnmergeThesisRequest(BaseModel):
    source: str


class MergeThesisByIdRequest(BaseModel):
    source_thesis_id: str
    target_thesis_id: str


class UnmergeThesisByIdRequest(BaseModel):
    source_thesis_id: str


def make_router(db: AsyncIOMotorDatabase, auth_required, auth_optional) -> APIRouter:
    router = APIRouter(prefix="/thesis")

    _preset_loaded = {"done": False}

    async def _ensure_preset_loaded():
        """Restore the model preset chosen previously (survives restarts). Lazy:
        runs once on the first relevant request, where an event loop is running."""
        if _preset_loaded["done"]:
            return
        _preset_loaded["done"] = True
        try:
            doc = await db.app_settings.find_one({"id": "thesis_models"}, {"_id": 0})
            if doc and doc.get("preset"):
                set_model_preset(doc["preset"])
        except Exception as e:
            logger.warning(f"could not load model preset: {e}")

    async def _record_usage(cost: Optional[dict], count_thesis: bool = True):
        """Accumulate per-preset usage counters: # generaciones + € estimados."""
        preset = get_model_preset()
        inc: Dict[str, Any] = {}
        if count_thesis:
            inc[f"presets.{preset}.theses"] = 1
        if cost:
            inc[f"presets.{preset}.cost_eur"] = round(float(cost.get("cost_eur") or 0.0), 6)
            inc[f"presets.{preset}.calls"] = int(cost.get("calls") or 0)
        if not inc:
            return
        try:
            await db.app_settings.update_one({"id": "thesis_usage"}, {"$inc": inc}, upsert=True)
        except Exception as e:
            logger.warning(f"usage record failed: {e}")

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

    async def _suggest_parent(user_id: str, new_id: str, thesis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """LLM check: is this freshly generated TREND thesis a sub-segment (child) of
        an existing one? Returns a manual-confirm suggestion {thesis_id, title, reason}
        or None. Used to prevent TAM double-counting (the child's TAM is later excluded
        from megatrend aggregates once the user nests it)."""
        others_docs = await db.theses.find(
            {"user_id": user_id, "type": "trend", "id": {"$ne": new_id}},
            {"_id": 0, "id": 1, "title": 1, "summary": 1, "tam": 1},
        ).to_list(length=300)
        others = [{"id": o["id"], "title": o.get("title"), "summary": o.get("summary"),
                   "tam_busd": (o.get("tam") or {}).get("global_busd")} for o in others_docs]
        if not others:
            return None
        try:
            res = await asyncio.to_thread(
                _detect_parent_sync, thesis.get("title"), thesis.get("summary"),
                (thesis.get("tam") or {}).get("global_busd"), others)
        except Exception as e:
            logger.warning(f"parent detection failed ({new_id}): {e}")
            return None
        pid = res.get("parent_id")
        if not pid:
            return None
        parent = next((o for o in others if o["id"] == pid), None)
        return {"thesis_id": pid, "title": parent.get("title") if parent else None,
                "reason": res.get("reason")}

    async def _run_generate_job(job_id: str, kind: str, subject: str, user_id: Optional[str], matched_thesis_id: Optional[str] = None, overwrite_thesis_id: Optional[str] = None, from_company: Optional[str] = None, core: Optional[str] = None, develop_whole: bool = False):
        async def _record_split_dev(company_id: str, the_core: Optional[str], split_name: Optional[str], developed_id: str, whole: bool):
            """Persist (informationally) on the origin company thesis that one of its
            core theses was developed by a split (or as a whole), so the suggestions
            page shows a note + the remaining splits as their own cards."""
            company = await db.theses.find_one({"id": company_id, "user_id": user_id}, {"_id": 0, "id": 1, "split_dev": 1})
            if not company:
                return
            entry = {"core": the_core, "split": None if whole else split_name, "developed_id": developed_id, "whole": bool(whole)}
            existing = company.get("split_dev") or []
            existing = [
                e for e in existing
                if not (e.get("core") == entry["core"] and bool(e.get("whole")) == entry["whole"] and e.get("split") == entry["split"])
            ]
            existing.append(entry)
            await db.theses.update_one({"id": company_id, "user_id": user_id}, {"$set": {"split_dev": existing}})

        try:
            # When developing a trend FROM a company core/split, pass the origin
            # company into the investigator prompt so it is included in its own thesis.
            origin_company = None
            alloc_tam = None        # the partition slice this developed thesis inherits
            origin_ticker = None    # the origin company's ticker (its score uses alloc_tam)
            if kind == "trend" and from_company and user_id:
                oc = await db.theses.find_one(
                    {"id": from_company, "user_id": user_id, "type": "company"},
                    {"_id": 0, "company": 1, "trends": 1},
                )
                if oc:
                    c = oc.get("company") or {}
                    nm = (c.get("name") or "").strip()
                    tk = (c.get("ticker") or "").strip()
                    if nm:
                        origin_company = f"{nm} ({tk})" if tk else nm
                    origin_ticker = (tk or "").upper() or None
                    # Resolve the inherited TAM slice from the company partition (driver
                    # is authoritative; split TAMs are normalized to sum to it).
                    def _nrm(x):
                        return (x or "").strip().lower()
                    driver = next((t for t in (oc.get("trends") or []) if _nrm(t.get("name")) == _nrm(core)), None)
                    if driver is not None:
                        dtam = driver.get("tam_busd")
                        if develop_whole or not (driver.get("splits") or []):
                            alloc_tam = dtam
                        else:
                            splits = driver.get("splits") or []
                            ssum = sum((s.get("tam_busd") or 0) for s in splits)
                            sp = next((s for s in splits if _nrm(s.get("name")) == _nrm(subject)), None)
                            sp_tam = (sp or {}).get("tam_busd")
                            if sp_tam is not None and dtam and ssum:
                                alloc_tam = round(float(sp_tam) * float(dtam) / float(ssum), 1)
                            else:
                                alloc_tam = sp_tam

            # Option A — regeneration-aware reconciliation: when rewriting a company
            # thesis (or updating a matched one), feed the company's already-saved trend
            # theses into Pass 2 so new proposals align with them (same names, no TAM
            # overlap with what's already developed → avoids cross-generation double counting).
            existing_theses = None
            if kind == "company" and user_id:
                base_id = overwrite_thesis_id or matched_thesis_id
                tk = None
                if base_id:
                    bdoc = await db.theses.find_one({"id": base_id, "user_id": user_id, "type": "company"}, {"_id": 0, "company": 1})
                    tk = ((bdoc or {}).get("company") or {}).get("ticker")
                tk = (tk or "").upper().strip()
                if tk:
                    saved = await db.theses.find(
                        {"user_id": user_id, "type": "trend", "companies.ticker": tk},
                        {"_id": 0, "title": 1, "tam": 1, "companies": 1},
                    ).to_list(length=50)
                    ex = []
                    for s in saved:
                        role = next((c.get("value_chain_role") for c in (s.get("companies") or [])
                                     if (c.get("ticker") or "").upper().strip() == tk), None)
                        ex.append({"title": s.get("title"), "global_busd": (s.get("tam") or {}).get("global_busd"), "role": role})
                    if ex:
                        existing_theses = ex

            thesis = await asyncio.to_thread(_generate_sync, kind, subject, origin_company, existing_theses)
            _cost = thesis.pop("_cost", None)
            await _record_usage(_cost)
            # Anchor the developed thesis to the company partition slice (Option A):
            # the origin company's TAM Score will use this, not the re-estimated chain.
            # Also persist source_company_thesis_id so the company→thesis page can
            # show ONLY the trends that were born from THIS company's plan (vs.
            # auto-included memberships from other companies' plans).
            if kind == "trend" and origin_ticker:
                thesis["origin_ticker"] = origin_ticker
                if alloc_tam is not None:
                    thesis["allocated_tam_busd"] = alloc_tam
            if kind == "trend" and from_company:
                thesis["source_company_thesis_id"] = from_company

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
                    # Rewrite a COMPANY thesis = "start from 0": delete every trend
                    # thesis previously developed FROM it and clear its split_dev +
                    # stale link cache, so the new generation starts clean.
                    if existing.get("type") == "company":
                        old_dev = [e.get("developed_id") for e in (existing.get("split_dev") or []) if e.get("developed_id")]
                        if old_dev:
                            await db.theses.delete_many({"id": {"$in": old_dev}, "user_id": user_id})
                        thesis["split_dev"] = []
                        thesis["link_matches"] = None
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
                        "parent_id": None,
                        "saved": False,
                        "trend_match_id": matched_thesis_id if (kind == "trend" and matched_thesis_id) else None,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        **thesis,
                    }
                    await db.theses.insert_one(doc)
                    await _persist_qual_snapshots(user_id, tid, thesis)
                    thesis["id"] = tid
                    thesis["saved"] = False
                # Developing a trend FROM a company core/split → record it on that company
                # thesis so its suggestions page shows the note + remaining split cards.
                if kind == "trend" and from_company and core:
                    await _record_split_dev(from_company, core, subject, tid, develop_whole)
                # Freeze the TAM Score: compute + store it now (from the cache) so it is
                # stable on every render and coherent with the company files.
                if kind == "trend":
                    try:
                        await recompute_and_store_tam(db, user_id, [tid])
                        fresh = await db.theses.find_one({"id": tid, "user_id": user_id}, {"_id": 0, "companies": 1})
                        if fresh and fresh.get("companies") is not None:
                            thesis["companies"] = fresh["companies"]
                    except Exception as e:
                        logger.warning(f"tam freeze after generate failed ({tid}): {e}")
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
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or f"Error generando la tesis: {e}"}})
        finally:
            # Generation finished (and saved) → start the next queued one, if any.
            try:
                await _start_next_queued(user_id)
            except Exception as e:
                logger.error(f"dequeue next generation failed: {e}")

    async def _run_contra_job(job_id: str, thesis_id: str, user_id: str):
        try:
            doc = await db.theses.find_one({"id": thesis_id, "user_id": user_id}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Tesis no encontrada"}})
                return
            contra = await asyncio.to_thread(_contra_sync, doc)
            _cost = contra.pop("_cost", None) if isinstance(contra, dict) else None
            await _record_usage(_cost, count_thesis=False)
            await db.theses.update_one({"id": thesis_id, "user_id": user_id}, {"$set": {"contra": contra}})
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": contra, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"contra generation failed ({thesis_id}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or f"Error generando la contratesis: {e}"}})

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

    async def _run_explore_job(job_id: str, subject: str):
        try:
            result = await asyncio.to_thread(_explore_sync, subject)
            _cost = result.pop("_cost", None)
            await _record_usage(_cost)
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": result, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except ValueError as e:
            await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": str(e)}})
        except Exception as e:
            logger.error(f"explore failed ({subject}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or f"Error explorando la tendencia: {e}"}})

    async def _run_autotrend_job(job_id: str, exclude):
        try:
            result = await asyncio.to_thread(_auto_trend_sync, exclude)
            _cost = result.pop("_cost", None)
            await _record_usage(_cost)
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": result, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except ValueError as e:
            await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": str(e)}})
        except Exception as e:
            logger.error(f"auto-trend failed: {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or f"Error generando la tendencia automática: {e}"}})

    async def _enqueue_generation(uid, kind, subject, *, matched_thesis_id=None,
                                  overwrite_thesis_id=None, from_company=None, core=None,
                                  develop_whole=False, allow_queue=True):
        """Create a generation job respecting the serial queue (one at a time per user).
        Returns (job_id, status, active). If busy and allow_queue is False → (None, 'busy', active)."""
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        params = {
            "kind": kind, "subject": subject,
            "matched_thesis_id": matched_thesis_id, "overwrite_thesis_id": overwrite_thesis_id,
            "from_company": from_company, "core": core, "develop_whole": develop_whole,
        }
        base = {"id": job_id, "user_id": uid, "kind": "generate",
                "created_at": datetime.now(timezone.utc).isoformat(), "params": params}
        if uid:
            active = await db.thesis_jobs.find_one(
                {"user_id": uid, "kind": "generate", "status": {"$in": ["processing", "queued"]}},
                sort=[("created_at", 1)],
            )
            if active:
                if not allow_queue:
                    ap = active.get("params") or {}
                    return None, "busy", {"subject": ap.get("subject"), "kind": ap.get("kind")}
                await db.thesis_jobs.insert_one({**base, "status": "queued"})
                return job_id, "queued", None
        await db.thesis_jobs.insert_one({**base, "status": "processing"})
        _spawn(_run_generate_job(job_id, kind, subject, uid, matched_thesis_id, overwrite_thesis_id, from_company, core, develop_whole))
        return job_id, "processing", None

    async def _start_next_queued(uid):
        """Serial queue advance: when a generation finishes, promote the oldest queued
        job (FIFO) to processing and start it. One running generation per user. Without
        this, queued theses (e.g. from /generate-plan) would stay 'queued' forever."""
        if not uid:
            return
        running = await db.thesis_jobs.find_one(
            {"user_id": uid, "kind": "generate", "status": "processing"})
        if running:
            return  # something already running → it will dequeue the next when it ends
        nxt = await db.thesis_jobs.find_one(
            {"user_id": uid, "kind": "generate", "status": "queued"},
            sort=[("created_at", 1)])
        if not nxt:
            return
        await db.thesis_jobs.update_one({"id": nxt["id"]}, {"$set": {"status": "processing"}})
        p = nxt.get("params") or {}
        _spawn(_run_generate_job(
            nxt["id"], p.get("kind"), p.get("subject"), uid,
            p.get("matched_thesis_id"), p.get("overwrite_thesis_id"),
            p.get("from_company"), p.get("core"), p.get("develop_whole", False)))

    async def _company_locked(uid, thesis_id, split_dev=None):
        """Planning is locked once a plan is executed: any developed thesis (split_dev)
        or an in-flight generation launched from this company."""
        if split_dev is None:
            d = await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0, "split_dev": 1})
            split_dev = (d or {}).get("split_dev")
        if split_dev:
            return True
        inflight = await db.thesis_jobs.find_one({
            "user_id": uid, "kind": "generate", "status": {"$in": ["processing", "queued"]},
            "params.from_company": thesis_id,
        })
        return bool(inflight)

    @router.post("/generate")
    async def generate(req: GenerateRequest, user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        await _ensure_preset_loaded()
        kind = req.type.strip().lower()
        subject = (req.subject or "").strip()
        if kind not in ("trend", "company"):
            raise HTTPException(status_code=400, detail="type debe ser 'trend' o 'company'")
        if not subject:
            raise HTTPException(status_code=400, detail="subject requerido")
        uid = user["user_id"] if user else None
        job_id, status, active = await _enqueue_generation(
            uid, kind, subject, matched_thesis_id=req.matched_thesis_id,
            overwrite_thesis_id=req.overwrite_thesis_id, from_company=req.from_company,
            core=req.core, develop_whole=req.develop_whole, allow_queue=req.queue)
        if status == "busy":
            return {"status": "busy", "active": active}
        out = {"job_id": job_id, "status": status}
        if status == "queued":
            out["position"] = await db.thesis_jobs.count_documents(
                {"user_id": uid, "kind": "generate", "status": "queued"})
        return out

    @router.get("/models")
    async def get_models(user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        """Model presets + active preset + estimated usage counters (dev cost tool)."""
        await _ensure_preset_loaded()
        usage = await db.app_settings.find_one({"id": "thesis_usage"}, {"_id": 0}) or {}
        upresets = usage.get("presets") or {}
        presets = []
        for key, p in MODEL_PRESETS.items():
            u = upresets.get(key) or {}
            inv = p["investigator"]
            syn = p["synthesizer"]
            presets.append({
                "key": key,
                "label": p["label"],
                "desc": p["desc"],
                "investigator": f"{inv[0]}:{inv[1]}",
                "synthesizer": f"{syn[0]}:{syn[1]}",
                "theses": int(u.get("theses") or 0),
                "cost_eur": round(float(u.get("cost_eur") or 0.0), 4),
            })
        return {"active": get_model_preset(), "presets": presets}

    @router.put("/models")
    async def set_models(req: SetModelRequest, user: Dict[str, Any] = Depends(auth_required)):
        if not set_model_preset(req.preset):
            raise HTTPException(status_code=400, detail="preset no válido")
        await db.app_settings.update_one(
            {"id": "thesis_models"}, {"$set": {"id": "thesis_models", "preset": req.preset}}, upsert=True)
        return {"active": get_model_preset()}

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

    @router.post("/explore")
    async def explore(req: ExploreRequest, user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        """Informational (structural-only) trend exploration: value chain + ≥1 leader and
        ≥1 disruptor per stage, no scoring. Works anonymously (ephemeral result)."""
        await _ensure_preset_loaded()
        subject = (req.subject or "").strip()
        if not subject:
            raise HTTPException(status_code=400, detail="subject requerido")
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id,
            "user_id": user["user_id"] if user else None,
            "kind": "explore",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_explore_job(job_id, subject))
        return {"job_id": job_id}

    @router.post("/auto-trend")
    async def auto_trend(req: AutoTrendRequest, user: Optional[Dict[str, Any]] = Depends(auth_optional)):
        """Generate ONE automatic emerging trend (by current momentum), avoiding the
        names passed in `exclude`. Returns an informational 'tendencia' (no scoring)."""
        await _ensure_preset_loaded()
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id,
            "user_id": user["user_id"] if user else None,
            "kind": "auto_trend",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_autotrend_job(job_id, req.exclude or []))
        return {"job_id": job_id}

    @router.post("/tendencia/save")
    async def save_tendencia(req: SaveTendenciaRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Persist an informational trend ('tendencia') so it shows in the sidebar.
        If `overwrite_id` is set, the existing tendencia is deleted first (so the
        Reescribir/machacar flow from the dedup-warning replaces it cleanly without
        leaving a duplicate). Discard is purely client-side (the ephemeral result is
        just dropped)."""
        t = req.tendencia or {}
        if not (t.get("title") or t.get("query")):
            raise HTTPException(status_code=400, detail="tendencia inválida")
        if req.overwrite_id:
            await db.theses.delete_one({"id": req.overwrite_id, "user_id": user["user_id"], "type": "tendencia"})
        tid = f"thesis_{uuid.uuid4().hex[:12]}"
        doc = {
            "id": tid,
            "user_id": user["user_id"],
            "type": "tendencia",
            "saved": True,
            "folder_id": None,
            "title": t.get("title") or t.get("query"),
            "query": t.get("query"),
            "summary": t.get("summary"),
            "tam": t.get("tam"),
            "cagr_4y": t.get("cagr_4y"),
            "cagr_note": t.get("cagr_note"),
            "value_chain": t.get("value_chain") or [],
            "companies": t.get("companies") or [],
            "heat": t.get("heat"),
            "why_now": t.get("why_now"),
            "sector": t.get("sector"),
            "sources": t.get("sources") or [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.theses.insert_one(doc)
        return {"id": tid, "saved": True}

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
    async def company_profile(ticker: str, from_company: Optional[str] = None, user: Dict[str, Any] = Depends(auth_required)):
        """Coherent qualitative profile for a ticker: rows of saved trend theses
        where this ticker appears, split in TWO groups:

        - `trend_rows`: trend theses BORN from THIS ticker's own company plan
          (source_company_thesis_id == the company thesis id). These are the
          authoritative ones — `avg_overall_score` and `sum_tam_score` are
          computed ONLY over them, so the totals match the planning view and
          the dashboard "Empresas TAM".
        - `other_rows`: informative-only rows where the ticker appears in trend
          theses NOT born from its own plan (auto-included by the LLM matcher
          from other companies' plans, or independent trend searches). They do
          NOT contribute to the totals.

        The plan id is auto-resolved from the latest company thesis for this
        ticker if `from_company` is not explicit.
        """
        tk = ticker.upper().strip()
        uid = user["user_id"]

        # Resolve the implicit "own plan" id (latest company thesis for this ticker).
        rev_doc = await db.theses.find_one(
            {"user_id": uid, "type": "company", "company.ticker": tk},
            {"_id": 0, "id": 1, "title": 1, "overall_relevance": 1},
            sort=[("created_at", -1)],
        )
        plan_id = from_company or (rev_doc.get("id") if rev_doc else None)

        cur = db.theses.find(
            {"user_id": uid, "type": "trend", "companies.ticker": tk},
            {"_id": 0, "id": 1, "title": 1, "companies": 1, "value_chain": 1,
             "tam": 1, "source_company_thesis_id": 1},
        )
        theses = await cur.to_list(length=500)
        rev_busd, currency = await _projected_revenue_usd_busd(tk)

        plan_rows: List[Dict[str, Any]] = []
        other_rows: List[Dict[str, Any]] = []
        for t in theses:
            comp = next((c for c in (t.get("companies") or []) if (c.get("ticker") or "").upper() == tk), None)
            if not comp:
                continue
            overall = comp.get("overall_score")
            role = comp.get("value_chain_role")
            stage_tam = effective_stage_tam(comp, t.get("value_chain"), (t.get("tam") or {}).get("global_busd"))
            stored = comp.get("tam_score")
            row = {
                "thesis_id": t.get("id"),
                "thesis_title": t.get("title"),
                "overall_score": overall,
                "value_chain_role": role,
                "tam_score": stored if stored is not None else compute_tam_score(overall, stage_tam, rev_busd),
            }
            if plan_id and t.get("source_company_thesis_id") == plan_id:
                plan_rows.append(row)
            else:
                other_rows.append(row)

        plan_rows.sort(key=lambda r: (r["overall_score"] is None, -(r["overall_score"] or 0)))
        other_rows.sort(key=lambda r: (r["overall_score"] is None, -(r["overall_score"] or 0)))

        overalls = [r["overall_score"] for r in plan_rows if r["overall_score"] is not None]
        tams = [r["tam_score"] for r in plan_rows if r["tam_score"] is not None]
        avg_overall = round(sum(overalls) / len(overalls), 1) if overalls else None
        sum_tam = round(sum(tams), 2) if tams else None

        reverse = None
        if rev_doc:
            reverse = {
                "thesis_id": rev_doc.get("id"),
                "thesis_title": rev_doc.get("title"),
                "overall_relevance": rev_doc.get("overall_relevance"),
            }

        return {
            "ticker": tk,
            "plan_id": plan_id,
            "projected_revenue_busd": round(rev_busd, 2) if rev_busd else None,
            "currency": currency,
            "trend_rows": plan_rows,
            "other_rows": other_rows,
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
            {"_id": 0, "id": 1, "title": 1, "folder_id": 1, "parent_id": 1, "tam": 1,
             "value_chain": 1, "companies": 1, "created_at": 1,
             "source_company_thesis_id": 1},
        ).sort("created_at", -1).to_list(length=1000)
        company_docs = await db.theses.find(
            {"user_id": uid, "type": "company"},
            {"_id": 0, "id": 1, "title": 1, "folder_id": 1, "company": 1,
             "overall_relevance": 1, "trends": 1, "split_dev": 1, "created_at": 1,
             "updated_at": 1, "generated_at": 1},
        ).sort("created_at", -1).to_list(length=1000)
        folders = await db.thesis_folders.find(
            {"user_id": uid}, {"_id": 0}
        ).sort("created_at", -1).to_list(length=200)
        tendencia_docs = await db.theses.find(
            {"user_id": uid, "type": "tendencia"},
            {"_id": 0, "id": 1, "title": 1, "query": 1, "tam": 1, "cagr_4y": 1,
             "companies": 1, "folder_id": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=500)

        # Bulk projected-revenue map (USD billions) from the fundamentals cache only.
        tickers = set()
        for t in trend_docs:
            for c in (t.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                if tk:
                    tickers.add(tk)
        for d in company_docs:  # include company-plan tickers (for mrq / staleness)
            tk = ((d.get("company") or {}).get("ticker") or "").upper().strip()
            if tk:
                tickers.add(tk)
        rev_map: Dict[str, float] = {}
        mrq_map: Dict[str, Optional[str]] = {}  # ticker → most_recent_quarter (ISO date)
        if tickers:
            cached = await db.fundamentals.find(
                {"ticker": {"$in": list(tickers)}}, {"_id": 0, "ticker": 1, "data": 1}
            ).to_list(length=2000)
            for cd in cached:
                data = cd.get("data") or {}
                mrq_map[cd.get("ticker")] = data.get("most_recent_quarter")
                rev2y = (data.get("auto_projections") or {}).get("revenue_2y")
                if rev2y is None:
                    continue
                currency = data.get("currency") or "USD"
                usd = await fx_service.convert(float(rev2y), currency, "USD")
                if usd and usd > 0:
                    rev_map[cd.get("ticker")] = usd / 1e9

        trends: List[Dict[str, Any]] = []
        comp_agg: Dict[str, Dict[str, Any]] = {}
        trend_id_set = {t.get("id") for t in trend_docs}
        # Build ticker → own-plan-id map (latest complete company thesis per ticker)
        # so we can roll up TAM/score per company ONLY from the trends BORN from its
        # own plan — matching the planning view and the standalone company page.
        ticker_to_plan_id: Dict[str, str] = {}
        ticker_to_updated: Dict[str, Optional[str]] = {}  # latest complete plan's update date
        for d in company_docs:  # already sorted by created_at desc
            tkc = ((d.get("company") or {}).get("ticker") or "").upper().strip()
            if not tkc or tkc in ticker_to_plan_id:
                continue
            if company_is_complete(d):
                ticker_to_plan_id[tkc] = d.get("id")
                ticker_to_updated[tkc] = d.get("updated_at") or d.get("generated_at") or d.get("created_at")
        for t in trend_docs:
            vc = t.get("value_chain") or []
            gtam = (t.get("tam") or {}).get("global_busd")
            src = t.get("source_company_thesis_id")
            clist = []
            for c in (t.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                overall = c.get("overall_score")
                tam_score = c.get("tam_score") if c.get("tam_score") is not None else compute_tam_score(overall, effective_stage_tam(c, vc, gtam), rev_map.get(tk))
                clist.append({
                    "ticker": tk or None, "name": c.get("name"), "overall_score": overall,
                    "value_chain_role": c.get("value_chain_role"),
                    "tam_score": tam_score, "category": c.get("category"),
                })
                # Only roll this row into the company aggregate if the trend was BORN
                # from this ticker's own plan. Otherwise it's an "informative" ghost
                # membership that must not inflate the company's totals.
                if tk and ticker_to_plan_id.get(tk) and src == ticker_to_plan_id[tk]:
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
                "parent_id": t.get("parent_id"),
                "is_child": bool(t.get("parent_id") and t.get("parent_id") in trend_id_set),
                "tam_busd": (t.get("tam") or {}).get("global_busd"),
                "company_count": len(clist), "companies": clist,
                "source_company_thesis_id": src,
            })

        # Surface every complete company even if no trends rolled into its aggregate
        # (e.g. plan generated but all developed theses still pending). Avoids empty
        # rows vanishing from the dashboard treemap after the source-filter change.
        complete_tickers = set(ticker_to_plan_id.keys())
        # Pull canonical names from the company docs (works when no trend row rolled in).
        ticker_to_name: Dict[str, Optional[str]] = {}
        for d in company_docs:
            tkc = ((d.get("company") or {}).get("ticker") or "").upper().strip()
            if tkc and tkc in complete_tickers and tkc not in ticker_to_name:
                ticker_to_name[tkc] = (d.get("company") or {}).get("name")
        companies = []
        for tk in complete_tickers:
            a = comp_agg.get(tk, {"ticker": tk, "name": None, "scores": [], "tams": [], "trends": []})
            avg = round(sum(a["scores"]) / len(a["scores"]), 1) if a["scores"] else None
            stam = round(sum(a["tams"]), 2) if a["tams"] else None
            companies.append({
                "ticker": tk, "name": a["name"] or ticker_to_name.get(tk),
                "avg_overall_score": avg, "sum_tam_score": stam,
                "trends": a["trends"], "trend_count": len(a["trends"]),
                "updated_at": ticker_to_updated.get(tk),
                "most_recent_quarter": mrq_map.get(tk),
            })
        companies.sort(key=lambda c: (c["avg_overall_score"] is None, -(c["avg_overall_score"] or 0)))

        # Tendencias (the 'Tendencias → Empresas' results) are now the dashboard's
        # first-class entities: each carries its TAM (2027) and forward 4y CAGR, and can
        # be grouped into a megatendencia (folder).
        tendencias_out = []
        for d in tendencia_docs:
            tendencias_out.append({
                "id": d.get("id"),
                "title": d.get("title") or d.get("query"),
                "query": d.get("query"),
                "tam_busd": (d.get("tam") or {}).get("global_busd"),
                "cagr_4y": d.get("cagr_4y"),
                "folder_id": d.get("folder_id"),
            })

        # Megatendencias (folders) aggregate their TENDENCIAS: TAM = sum, CAGR = average.
        folder_out = []
        for f in folders:
            contained = [t for t in tendencias_out if t["folder_id"] == f.get("id")]
            tams = [t["tam_busd"] for t in contained if t["tam_busd"] is not None]
            cagrs = [t["cagr_4y"] for t in contained if t["cagr_4y"] is not None]
            folder_out.append({
                "id": f.get("id"), "name": f.get("name"),
                "tam_busd": round(sum(tams), 1) if tams else None,
                "cagr_4y": round(sum(cagrs) / len(cagrs), 1) if cagrs else None,
                "tendencia_ids": [t["id"] for t in contained],
                "tendencia_count": len(contained),
            })

        # Company dropdown: list ONLY the tesis NACIDAS de esta empresa (drivers
        # desarrollados desde su plan). Las membresías "fantasma" en tesis nacidas
        # de otros planes NO aparecen aquí — solo bajo "También aparece en (informativo)"
        # de /company/{TICKER}, manteniendo la coherencia con el sum_tam_score.
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
                if tr.get("source_company_thesis_id") == d.get("id")
            ]
            company_theses.append({
                "id": d.get("id"), "title": d.get("title"), "folder_id": d.get("folder_id"),
                "ticker": tk or None, "overall_relevance": d.get("overall_relevance"),
                "fit_trends": fit,
                "updated_at": d.get("updated_at") or d.get("generated_at") or d.get("created_at"),
                "most_recent_quarter": mrq_map.get(tk) if tk else None,
            })

        # Convergencia: empresas que aparecen en VARIAS de las tendencias del usuario
        # (señal de convergencia de megatendencias). Pura agregación, sin LLM. Marca su
        # mezcla de categorías (líder/competidor/disruptor) y si ya está analizada (la
        # empresa tiene una tesis de empresa completamente desarrollada). Devolvemos las
        # de count≥2; el umbral final es configurable en el frontend.
        cthesis_by_ticker = {ct["ticker"]: ct["id"] for ct in company_theses if ct.get("ticker")}
        conv = {}
        for td in tendencia_docs:
            seen = set()  # avoid double-counting a ticker listed twice in one tendencia
            for c in (td.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                if not tk or tk in seen:
                    continue
                seen.add(tk)
                cat = (c.get("category") or "competitor").strip().lower()
                e = conv.setdefault(tk, {"ticker": tk, "name": c.get("name"),
                                         "tendencias": [], "leader": 0, "competitor": 0, "disruptor": 0})
                e["tendencias"].append({"id": td.get("id"), "title": td.get("title") or td.get("query"), "category": cat})
                e[cat if cat in ("leader", "competitor", "disruptor") else "competitor"] += 1
        convergence = []
        for tk, e in conv.items():
            if len(e["tendencias"]) < 2:
                continue
            convergence.append({
                "ticker": tk, "name": e["name"], "count": len(e["tendencias"]),
                "tendencias": e["tendencias"],
                "leader": e["leader"], "competitor": e["competitor"], "disruptor": e["disruptor"],
                "analyzed": tk in complete_tickers,
                "company_thesis_id": cthesis_by_ticker.get(tk),
            })
        convergence.sort(key=lambda x: -x["count"])

        return {"folders": folder_out, "trends": trends,
                "companies": companies, "company_theses": company_theses,
                "tendencias": tendencias_out, "convergence": convergence}

    @router.get("/visual")
    async def visual_data(user: Dict[str, Any] = Depends(auth_required)):
        """Returns the universe of companies that are members of any of the user's
        TREND theses (already fully developed), enriched with their POC/POV ratios
        pulled from the fundamentals cache. Powers the /visual page (BCG quadrant
        map + sortable opportunities table).

        Each row: {ticker, name, avg_overall_score, sum_tam_score,
                   ratio_compra_pct, ratio_venta_pct, current_price, currency,
                   trends: [{thesis_id, title, overall_score, tam_score}],
                   trend_count}
        """
        # Reuse the dashboard's company aggregation by calling it inline (cheap):
        # this keeps the score/TAM aggregation logic in ONE place.
        dash = await dashboard(user)  # type: ignore[arg-type]
        companies = dash.get("companies") or []
        if not companies:
            return {"rows": []}

        tickers = [c["ticker"] for c in companies if c.get("ticker")]
        cached = await db.fundamentals.find(
            {"ticker": {"$in": tickers}}, {"_id": 0, "ticker": 1, "data": 1}
        ).to_list(length=len(tickers))
        by_ticker: Dict[str, Dict[str, Any]] = {cd["ticker"]: cd.get("data") or {} for cd in cached}

        # KPI coefficient per ticker: join with the user's most recent COMPANY thesis
        # that has a kpi_snapshot.coef_global (deduped by ticker, latest wins).
        kpi_docs = await db.theses.find(
            {"user_id": user["user_id"], "type": "company", "kpi_snapshot.coef_global": {"$ne": None}},
            {"_id": 0, "company": 1, "kpi_snapshot": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=500)
        kpi_by_ticker: Dict[str, float] = {}
        for kd in kpi_docs:
            tk = ((kd.get("company") or {}).get("ticker") or "").upper().strip()
            if tk and tk not in kpi_by_ticker:
                coef = (kd.get("kpi_snapshot") or {}).get("coef_global")
                if isinstance(coef, (int, float)):
                    kpi_by_ticker[tk] = float(coef)

        rows: List[Dict[str, Any]] = []
        for c in companies:
            tk = c["ticker"]
            d = by_ticker.get(tk) or {}
            ratio_c: Optional[float] = None
            ratio_v: Optional[float] = None
            price: Optional[float] = None
            currency: Optional[str] = None
            try:
                ap = d.get("auto_projections") or {}
                ratios = compute_custom_ratios({
                    "revenue_2y": ap.get("revenue_2y"),
                    "fcf_2y": ap.get("fcf_2y"),
                    "shares_outstanding": d.get("shares_outstanding"),
                    "gross_margin": d.get("gross_margin"),
                    "operating_margin": d.get("operating_margin"),
                    "net_debt": d.get("net_debt"),
                    "market_cap": d.get("market_cap"),
                    "revenue_cagr_4y": ap.get("revenue_cagr_4y"),
                    "fcf_cagr_4y": ap.get("fcf_cagr_4y"),
                    "current_price": d.get("current_price"),
                })
                ratio_c = ratios.get("ratio_compra_pct")
                ratio_v = ratios.get("ratio_venta_pct")
                price = d.get("current_price")
                currency = d.get("currency")
            except Exception:
                pass  # missing/incomplete fundamentals → ratios remain null
            rows.append({
                "ticker": tk,
                "name": c.get("name"),
                "avg_overall_score": c.get("avg_overall_score"),
                "sum_tam_score": c.get("sum_tam_score"),
                "kpi_coef": kpi_by_ticker.get((tk or "").upper().strip()),
                "ratio_compra_pct": ratio_c,
                "ratio_venta_pct": ratio_v,
                "current_price": price,
                "currency": currency,
                "trends": c.get("trends") or [],
                "trend_count": c.get("trend_count") or 0,
                "thesis_updated_at": c.get("updated_at"),
                "most_recent_quarter": c.get("most_recent_quarter"),
            })

        return {"rows": rows}

    # ---------------------- Per-company watch alerts (Visual bell) ----------------------
    class AlertMetric(BaseModel):
        enabled: bool = False
        dir: str = "gte"  # "gte" (≥) or "lte" (≤)
        value: Optional[float] = None

    class AlertConfigReq(BaseModel):
        score: AlertMetric = Field(default_factory=AlertMetric)
        tam: AlertMetric = Field(default_factory=AlertMetric)
        kpi: AlertMetric = Field(default_factory=AlertMetric)

    def _alert_has_any(cfg: dict) -> bool:
        return any((cfg.get(k) or {}).get("enabled") for k in ("score", "tam", "kpi"))

    @router.get("/alerts")
    async def list_alerts(user: Dict[str, Any] = Depends(auth_required)):
        """All watch-alert configs for the current user, keyed by ticker (for the bells)."""
        docs = await db.company_alerts.find(
            {"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(length=1000)
        return {"alerts": {d["ticker"]: d for d in docs}}

    @router.put("/alerts/{ticker}")
    async def save_alert(ticker: str, req: AlertConfigReq, user: Dict[str, Any] = Depends(auth_required)):
        """Create/update a company's alert. If no metric is enabled → remove the bell."""
        tk = (ticker or "").upper().strip()
        if not tk:
            raise HTTPException(status_code=400, detail="Ticker inválido")
        cfg = {"score": req.score.dict(), "tam": req.tam.dict(), "kpi": req.kpi.dict()}
        if not _alert_has_any(cfg):
            await db.company_alerts.delete_one({"user_id": user["user_id"], "ticker": tk})
            return {"ticker": tk, "removed": True}
        doc = {"user_id": user["user_id"], "ticker": tk, **cfg,
               "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.company_alerts.update_one(
            {"user_id": user["user_id"], "ticker": tk},
            {"$set": doc, "$setOnInsert": {"state": {}}}, upsert=True)
        saved = await db.company_alerts.find_one(
            {"user_id": user["user_id"], "ticker": tk}, {"_id": 0, "user_id": 0})
        return {"ticker": tk, "alert": saved}

    @router.delete("/alerts/{ticker}")
    async def delete_alert(ticker: str, user: Dict[str, Any] = Depends(auth_required)):
        await db.company_alerts.delete_one(
            {"user_id": user["user_id"], "ticker": (ticker or "").upper().strip()})
        return {"ok": True}

    _ALERT_CHEAP, _ALERT_FAIR = 20.0, 0.0

    def _ratio_signal(pct):
        if pct is None:
            return "—"
        if pct >= _ALERT_CHEAP:
            return "BARATA"
        if pct >= _ALERT_FAIR:
            return "JUSTA"
        return "CARA"

    def _metric_met(cfg, current):
        """True/False if an enabled metric condition is met now; None if not applicable."""
        if not cfg or not cfg.get("enabled") or current is None or cfg.get("value") is None:
            return None
        return current >= cfg["value"] if cfg.get("dir") == "gte" else current <= cfg["value"]

    def _alerts_email_html(user_name, qual_events, ratio_events):
        def q_rows():
            out = []
            for e in qual_events:
                out.append(f"""<tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #00000010;font-family:monospace;font-weight:600;">{e['ticker']}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #00000010;font-family:sans-serif;">{e['label']}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #00000010;text-align:right;font-family:monospace;">{e['value']}</td></tr>""")
            return "".join(out)
        def r_rows():
            out = []
            for e in ratio_events:
                color = "#1D7044" if e["now"] == "BARATA" else "#B32A22"
                out.append(f"""<tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #00000010;font-family:monospace;font-weight:600;">{e['ticker']}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #00000010;font-family:sans-serif;">{e['kind']}: <span style="color:#4A4A4A;">{e['prev']}</span> → <span style="color:{color};font-weight:600;">{e['now']}</span></td>
                    <td style="padding:8px 12px;border-bottom:1px solid #00000010;text-align:right;font-family:monospace;color:{color};">{e['pct']:+.1f}%</td></tr>""")
            return "".join(out)
        greeting = f"Hola {user_name.split()[0]}," if user_name else "Hola,"
        n = len(qual_events) + len(ratio_events)
        qual_block = f"""<tr><td style="padding:12px 16px 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#4A4A4A;">Cualitativo · umbrales alcanzados</td></tr>
            <tr><td><table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{q_rows()}</table></td></tr>""" if qual_events else ""
        ratio_block = f"""<tr><td style="padding:16px 16px 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#4A4A4A;">Valoración · cruces barato/caro</td></tr>
            <tr><td><table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{r_rows()}</table></td></tr>""" if ratio_events else ""
        return f"""<table width="100%" cellspacing="0" cellpadding="0" style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;">
            <tr><td style="padding:24px 16px 8px;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:28px;">Valuation Studio</div>
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4A4A4A;">Alertas de seguimiento</div>
            </td></tr>
            <tr><td style="padding:8px 16px 4px;"><p style="margin:0;font-size:14px;">{greeting} hoy {n} de tus empresas vigiladas han cambiado de situación:</p></td></tr>
            {qual_block}{ratio_block}
            <tr><td style="padding:16px;font-size:11px;color:#4A4A4A;line-height:1.5;">Aviso: notificación automática basada en tus datos y umbrales. No es asesoramiento de inversión. Configura o quita alertas desde la campanita de cada empresa en Visual.</td></tr>
        </table>"""

    async def run_company_alerts() -> Dict[str, Any]:
        """Daily scan: for every user with company alerts, evaluate qualitative thresholds
        (score/TAM/Coef KPI) and ratio barato↔caro crossings, firing ONLY on transition
        (anti-spam). Sends ONE consolidated email per user."""
        from screener import _send_email_resend
        summary = {"users_scanned": 0, "emails_sent": 0, "events": 0}
        user_ids = await db.company_alerts.distinct("user_id")
        for uid in user_ids:
            alerts = await db.company_alerts.find({"user_id": uid}, {"_id": 0}).to_list(length=1000)
            if not alerts:
                continue
            user = await db.users.find_one({"user_id": uid}, {"_id": 0})
            if not user or not user.get("email"):
                continue
            summary["users_scanned"] += 1
            try:
                data = await visual_data(user)  # reuse the exact Visual metrics
            except Exception as e:
                logger.warning(f"alerts: visual_data failed for {uid}: {e}")
                continue
            rows_by_tk = {(r.get("ticker") or "").upper(): r for r in data.get("rows", [])}
            qual_events, ratio_events = [], []
            for a in alerts:
                tk = a["ticker"]
                row = rows_by_tk.get(tk)
                if not row:
                    continue
                prev = a.get("state") or {}
                new_state = dict(prev)
                # Qualitative thresholds
                for key, label_txt, cur in (
                    ("score", "Score", row.get("avg_overall_score")),
                    ("tam", "TAM Score", row.get("sum_tam_score")),
                    ("kpi", "Coef KPI", row.get("kpi_coef")),
                ):
                    met = _metric_met(a.get(key), cur)
                    if met is None:
                        new_state.pop(key, None)
                        continue
                    if met and not prev.get(key):
                        cfg = a[key]
                        sym = "≥" if cfg.get("dir") == "gte" else "≤"
                        qual_events.append({"ticker": tk,
                            "label": f"{label_txt} {sym} {cfg['value']}",
                            "value": (round(cur, 2) if isinstance(cur, (int, float)) else cur)})
                    new_state[key] = bool(met)
                # Ratio barato/caro crossings (automatic for any bell)
                buy_now = _ratio_signal(row.get("ratio_compra_pct"))
                sell_now = _ratio_signal(row.get("ratio_venta_pct"))
                if buy_now == "BARATA" and prev.get("buy") not in (None, "BARATA") :
                    ratio_events.append({"ticker": tk, "kind": "Ratio Compra", "prev": prev.get("buy"),
                                         "now": "BARATA", "pct": row.get("ratio_compra_pct") or 0.0})
                if sell_now == "CARA" and prev.get("sell") not in (None, "CARA"):
                    ratio_events.append({"ticker": tk, "kind": "Ratio Venta", "prev": prev.get("sell"),
                                         "now": "CARA", "pct": row.get("ratio_venta_pct") or 0.0})
                new_state["buy"], new_state["sell"] = buy_now, sell_now
                await db.company_alerts.update_one(
                    {"user_id": uid, "ticker": tk}, {"$set": {"state": new_state}})
            if qual_events or ratio_events:
                summary["events"] += len(qual_events) + len(ratio_events)
                n = len(qual_events) + len(ratio_events)
                subject = f"Valuation Studio · {n} alerta{'s' if n != 1 else ''} de seguimiento"
                html = _alerts_email_html(user.get("name") or "", qual_events, ratio_events)
                if await _send_email_resend(user["email"], subject, html):
                    summary["emails_sent"] += 1
        logger.info(f"Company alerts run summary: {summary}")
        return summary

    router.run_company_alerts = run_company_alerts

    # ---------------------- KPI validation module ----------------------
    async def _auto_fetch_for_kpis(company_id: str, user_id: str, company: str, ticker: str):
        """Option A: open the top search results, read their FULL content, and
        auto-ingest up to FETCH_MAX_PDFS PDFs as 'auto' KPI documents (deduped by
        source URL → cached, never re-downloaded). Returns the enriched web
        sources (or None on failure → pipeline falls back to snippet search)."""
        try:
            search = await asyncio.to_thread(gather_kpi_sources, company, ticker)
        except Exception as e:
            logger.warning(f"kpi auto-fetch search failed ({company_id}): {e}")
            return None
        try:
            web_sources, pdfs = await asyncio.to_thread(fetch_full_sources, search, company, ticker)
        except Exception as e:
            logger.warning(f"kpi auto-fetch failed ({company_id}): {e}")
            return search
        # Map URL → human title from the search results, to name auto docs meaningfully
        # (fallback when the multimodal title extraction yields nothing).
        title_by_url = {}
        for s in (web_sources or []) + (search or []):
            u, ttl = s.get("url"), (s.get("title") or "").strip()
            if u and ttl and u not in title_by_url:
                title_by_url[u] = ttl
        existing_auto = await db.kpi_files.count_documents(
            {"company_id": company_id, "user_id": user_id, "is_deleted": False, "auto_fetched": True})
        added_auto = False
        for pdf in pdfs:
            url = pdf.get("url")
            if not url:
                continue
            existing = await db.kpi_files.find_one(
                {"company_id": company_id, "user_id": user_id, "source_url": url, "is_deleted": False},
                {"_id": 0, "id": 1})
            if existing:
                continue  # cached — already downloaded for this company
            count = await db.kpi_files.count_documents(
                {"company_id": company_id, "user_id": user_id, "is_deleted": False})
            if count >= KPI_MAX_FILES:
                break  # respect the 10-doc cap
            data, mime, fname = pdf["data"], pdf["mime"], pdf["filename"]
            fid = uuid.uuid4().hex
            storage_path = f"{APP_NAME}/kpi-files/{user_id}/{fid}.pdf"
            try:
                res = await asyncio.to_thread(put_object, storage_path, data, mime)
            except Exception as e:
                logger.warning(f"auto pdf storage failed {url}: {e}")
                continue
            try:
                ext_res = await asyncio.to_thread(_doc_extract_sync, data, "pdf", mime, company, fname)
            except Exception as e:
                logger.warning(f"auto pdf extract failed {url}: {e}")
                ext_res = {"title": None, "text": ""}
            now = datetime.now(timezone.utc).isoformat()
            rec = {
                "id": fid, "user_id": user_id, "company_id": company_id,
                "storage_path": res.get("path", storage_path), "original_filename": fname,
                "content_type": mime, "size": len(data), "ext": "pdf", "kind": "auto",
                "auto_fetched": True, "source_url": url,
                "display_name": ext_res.get("title") or title_by_url.get(url) or fname,
                "description": "Descargado automáticamente por la app (fuente web/IR).",
                "status": "ready", "selected": True, "is_deleted": False,
                "extracted_text": ext_res.get("text") or "", "created_at": now, "extracted_at": now,
            }
            sup = await _find_superseded(company_id, user_id, rec["display_name"], fid)
            if sup:
                rec["supersedes"] = sup
            await db.kpi_files.insert_one(rec)
            added_auto = True
        # SEC EDGAR fallback: if no investor deck PDF was found, US filers still
        # publish the substance in their latest 10-Q/10-K → ingest it as an auto doc.
        if not pdfs and ticker:
            existing_sec = await db.kpi_files.find_one(
                {"company_id": company_id, "user_id": user_id, "source": "sec", "is_deleted": False},
                {"_id": 0, "source_url": 1})
            try:
                sec = await asyncio.to_thread(fetch_latest_sec_report, ticker)
            except Exception as e:
                logger.warning(f"SEC fallback failed ({company_id}): {e}")
                sec = None
            count = await db.kpi_files.count_documents(
                {"company_id": company_id, "user_id": user_id, "is_deleted": False})
            already = existing_sec and existing_sec.get("source_url") == (sec or {}).get("url")
            if sec and not already and count < KPI_MAX_FILES:
                fid = uuid.uuid4().hex
                storage_path = f"{APP_NAME}/kpi-files/{user_id}/{fid}.htm"
                try:
                    res = await asyncio.to_thread(put_object, storage_path, sec["html"], "text/html")
                    now = datetime.now(timezone.utc).isoformat()
                    rec = {
                        "id": fid, "user_id": user_id, "company_id": company_id,
                        "storage_path": res.get("path", storage_path), "original_filename": sec["filename"],
                        "content_type": "text/html", "size": len(sec["html"]), "ext": "htm", "kind": "auto",
                        "auto_fetched": True, "source": "sec", "source_url": sec["url"],
                        "display_name": f"{sec['form']} {sec['date']} · SEC EDGAR",
                        "description": "Informe oficial descargado automáticamente de SEC EDGAR.",
                        "status": "ready", "selected": True, "is_deleted": False,
                        "extracted_text": sec["text"], "created_at": now, "extracted_at": now,
                    }
                    sup = await _find_superseded(company_id, user_id, rec["display_name"], fid)
                    if sup:
                        rec["supersedes"] = sup
                    await db.kpi_files.insert_one(rec)
                    added_auto = True
                except Exception as e:
                    logger.warning(f"SEC ingest failed ({company_id}): {e}")
        # HTML fallback (Opción A): if nothing official was captured (no deck PDF, no
        # SEC filing) and the company has no auto document yet, ingest the best earnings/
        # results WEB PAGE we fully read as an auto document, so there is always a source.
        if not added_auto and existing_auto == 0 and web_sources:
            saved_urls = set()
            for e in await db.kpi_files.find(
                {"company_id": company_id, "user_id": user_id, "is_deleted": False},
                {"_id": 0, "source_url": 1}).to_list(length=50):
                if e.get("source_url"):
                    saved_urls.add(e["source_url"])
            best = None
            for s in web_sources:
                su = (s.get("url") or "").strip()
                txt = (s.get("snippet") or "").strip()
                if not su.startswith("http") or su in saved_urls or len(txt) < 500:
                    continue
                blob = f"{su} {s.get('title') or ''} {txt}".lower()
                if any(k in blob for k in ("earnings", "quarter", "result", "investor",
                                           "shareholder", "revenue", "guidance",
                                           " q1", " q2", " q3", " q4", "fy2")):
                    best = s
                    break
            count = await db.kpi_files.count_documents(
                {"company_id": company_id, "user_id": user_id, "is_deleted": False})
            if best and count < KPI_MAX_FILES:
                txt = (best.get("snippet") or "").strip()
                fid = uuid.uuid4().hex
                storage_path = f"{APP_NAME}/kpi-files/{user_id}/{fid}.txt"
                try:
                    res = await asyncio.to_thread(put_object, storage_path, txt.encode("utf-8"), "text/plain")
                    now = datetime.now(timezone.utc).isoformat()
                    name = (best.get("title") or title_by_url.get(best.get("url")) or "Página de resultados").strip()[:120]
                    rec = {
                        "id": fid, "user_id": user_id, "company_id": company_id,
                        "storage_path": res.get("path", storage_path),
                        "original_filename": name, "content_type": "text/html", "size": len(txt.encode("utf-8")),
                        "ext": "htm", "kind": "auto", "auto_fetched": True, "source": "web",
                        "source_url": best.get("url"),
                        "display_name": name,
                        "description": "Página oficial/de resultados leída automáticamente de la web.",
                        "status": "ready", "selected": True, "is_deleted": False,
                        "extracted_text": txt, "created_at": now, "extracted_at": now,
                    }
                    await db.kpi_files.insert_one(rec)
                except Exception as e:
                    logger.warning(f"HTML fallback ingest failed ({company_id}): {e}")
        return web_sources

    async def _run_kpi_job(job_id: str, company_id: str, user_id: str, mode: str = "full"):
        try:
            doc = await db.theses.find_one(
                {"id": company_id, "user_id": user_id, "type": "company"}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Empresa no encontrada"}})
                return
            company = (doc.get("company") or {}).get("name") or doc.get("title") or company_id
            ticker = (doc.get("company") or {}).get("ticker") or ""
            drivers = _company_drivers(doc)
            prev = doc.get("kpi_snapshot") or {}
            incremental = mode == "incremental" and prev.get("kpis") is not None and prev.get("generated_at")

            if incremental:
                # ⚡ Actualizar: reuse current docs + stored news; extract ONLY docs added
                # since the last snapshot, then re-judge the full set. No web search / fetch.
                files = await db.kpi_files.find(
                    {"company_id": company_id, "user_id": user_id, "is_deleted": False,
                     "status": "ready", "selected": True}, {"_id": 0}).to_list(length=20)
                docs = _selected_doc_sources(files)
                prev_at = prev.get("generated_at") or ""
                new_files = [f for f in files if (f.get("created_at") or "") > prev_at]
                new_docs = _selected_doc_sources(new_files)
                context_news = await _load_company_news(company_id, user_id)
                snap = await asyncio.to_thread(
                    _kpi_incremental_sync, company, ticker, drivers,
                    prev.get("kpis") or [], new_docs, context_news, docs, prev.get("period"))
            else:
                # 🔄 Reanalizar (full): heavy document fetch (Fase 2/3) and news refresh
                # (Fase 4) in PARALLEL — independent (news consumed later, by the judge).
                async def _refresh_news():
                    try:
                        fresh = await asyncio.to_thread(_news_sync, company, ticker, drivers, None)
                        await _news_merge_prune(company_id, user_id, ticker, fresh, "analysis")
                    except Exception as ne:
                        logger.warning(f"kpi news refresh failed ({company_id}): {ne}")
                web_sources, _ = await asyncio.gather(
                    _auto_fetch_for_kpis(company_id, user_id, company, ticker),
                    _refresh_news(),
                )
                files = await db.kpi_files.find(
                    {"company_id": company_id, "user_id": user_id, "is_deleted": False,
                     "status": "ready", "selected": True}, {"_id": 0}).to_list(length=20)
                docs = _selected_doc_sources(files)
                context_news = await _load_company_news(company_id, user_id)
                snap = await asyncio.to_thread(_kpi_sync, company, ticker, drivers, docs, context_news, web_sources)
            snap.pop("_cost", None)
            snap["generated_at"] = datetime.now(timezone.utc).isoformat()
            snap["ticker"] = ticker
            snap["no_source_doc"] = not files  # E: no official/source document available → UI shows a notice
            # Trend history of the global coefficient across (re)analyses (one point per day).
            history = [h for h in (prev.get("coef_history") or []) if h.get("date") != snap["generated_at"][:10]]
            if snap.get("coef_global") is not None:
                history.append({"date": snap["generated_at"][:10], "coef": snap["coef_global"]})
            snap["coef_history"] = history[-20:]
            await db.theses.update_one(
                {"id": company_id, "user_id": user_id}, {"$set": {"kpi_snapshot": snap}})
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": snap,
                          "updated_at": datetime.now(timezone.utc).isoformat()}})
        except Exception as e:
            logger.error(f"kpi job failed ({company_id}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or f"Error analizando KPIs: {e}"}})

    @router.get("/kpi-companies")
    async def kpi_companies(user: Dict[str, Any] = Depends(auth_required)):
        """Companies with a fully-developed thesis (eligible for KPI analysis),
        deduped by ticker (latest plan). Each flags whether KPIs were already run."""
        docs = await db.theses.find(
            {"user_id": user["user_id"], "type": "company"},
            {"_id": 0, "id": 1, "company": 1, "trends": 1, "split_dev": 1, "kpi_snapshot": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=500)
        seen, out = set(), []
        for d in docs:
            tk = ((d.get("company") or {}).get("ticker") or "").upper().strip()
            if not tk or tk in seen:
                continue
            if not company_is_complete(d):
                continue
            seen.add(tk)
            snap = d.get("kpi_snapshot") or {}
            out.append({
                "id": d["id"], "ticker": tk,
                "name": (d.get("company") or {}).get("name"),
                "has_kpis": bool(snap),
                "coef_global": snap.get("coef_global"),
                "kpi_generated_at": snap.get("generated_at"),
            })
        # Attach the latest reported quarter (from the fundamentals cache) so the UI can
        # flag a KPI snapshot as stale when the company has reported since it was generated.
        if out:
            cached = await db.fundamentals.find(
                {"ticker": {"$in": [o["ticker"] for o in out]}},
                {"_id": 0, "ticker": 1, "data.most_recent_quarter": 1},
            ).to_list(length=len(out))
            mrq = {cd["ticker"]: (cd.get("data") or {}).get("most_recent_quarter") for cd in cached}
            for o in out:
                o["most_recent_quarter"] = mrq.get(o["ticker"])
        return {"companies": out}

    @router.post("/{company_id}/kpis")
    async def run_kpis(company_id: str, mode: str = "full", user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0, "id": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        mode = "incremental" if mode == "incremental" else "full"
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id, "user_id": user["user_id"], "kind": "kpis",
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_kpi_job(job_id, company_id, user["user_id"], mode))
        return {"job_id": job_id}

    @router.get("/{company_id}/kpis")
    async def get_kpis(company_id: str, user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"},
            {"_id": 0, "kpi_snapshot": 1, "company": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        return {"company": doc.get("company"), "kpi_snapshot": doc.get("kpi_snapshot")}

    @router.put("/{company_id}/kpis")
    async def edit_kpis(company_id: str, req: EditKpisRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Manual correction: recompute the coefficient deterministically from the
        edited KPIs (signal/weight/values) — no LLM. Keeps period/verdicts/sources."""
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        snap = doc.get("kpi_snapshot")
        if not snap:
            raise HTTPException(status_code=400, detail="Esta empresa aún no tiene KPIs analizados")
        driver_names = [d.get("name") for d in (snap.get("drivers") or []) if d.get("name")]
        recomputed = compute_kpi_coefficients(req.kpis, driver_names, snap.get("alpha") or 0.5)
        # Preserve per-driver verdicts + period/sources/meta from the original snapshot.
        verdicts = {(d.get("name") or "").strip().lower(): d.get("verdict") for d in (snap.get("drivers") or [])}
        for d in recomputed["drivers"]:
            d["verdict"] = verdicts.get((d.get("name") or "").strip().lower())
        recomputed["period"] = snap.get("period")
        recomputed["sources"] = snap.get("sources")
        recomputed["ticker"] = snap.get("ticker")
        recomputed["generated_at"] = snap.get("generated_at")
        recomputed["edited_at"] = datetime.now(timezone.utc).isoformat()
        recomputed["coef_history"] = snap.get("coef_history") or []
        await db.theses.update_one(
            {"id": company_id, "user_id": user["user_id"]}, {"$set": {"kpi_snapshot": recomputed}})
        return {"kpi_snapshot": recomputed}

    async def _run_kpi_search_job(job_id: str, company_id: str, user_id: str, query: str):
        try:
            doc = await db.theses.find_one(
                {"id": company_id, "user_id": user_id, "type": "company"}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Empresa no encontrada"}})
                return
            company = (doc.get("company") or {}).get("name") or doc.get("title") or company_id
            ticker = (doc.get("company") or {}).get("ticker") or ""
            drivers = _company_drivers(doc)
            files = await db.kpi_files.find(
                {"company_id": company_id, "user_id": user_id, "is_deleted": False,
                 "status": "ready", "selected": True}, {"_id": 0}).to_list(length=20)
            docs = _selected_doc_sources(files)
            res = await asyncio.to_thread(_kpi_search_sync, company, ticker, drivers, query, docs)
            new_kpis = res.get("kpis") or []
            new_sources = res.pop("_sources", []) or []

            snap = doc.get("kpi_snapshot") or {}
            existing = snap.get("kpis") or []
            alpha = snap.get("alpha") or 0.5
            driver_names = [d.get("name") for d in drivers if d.get("name")]

            if not new_kpis:
                # Nothing found: keep the snapshot, just attach a transient note for the UI.
                result = dict(snap)
                result["search_note"] = res.get("note") or "No se encontró ese dato en fuentes recientes."
                await db.thesis_jobs.update_one(
                    {"id": job_id}, {"$set": {"status": "done", "result": result,
                                              "updated_at": datetime.now(timezone.utc).isoformat()}})
                return

            # Merge: a new KPI replaces an existing one with the same (name, driver).
            def key(k):
                return ((k.get("name") or "").strip().lower(), (k.get("driver") or "").strip().lower())
            new_keys = {key(k) for k in new_kpis}
            merged = [k for k in existing if key(k) not in new_keys] + new_kpis

            recomputed = compute_kpi_coefficients(merged, driver_names, alpha)
            # Preserve verdicts (existing + any new from this search).
            verdicts = {(d.get("name") or "").strip().lower(): d.get("verdict") for d in (snap.get("drivers") or [])}
            for d in (res.get("judged_drivers") or []):
                if d.get("verdict"):
                    verdicts[(d.get("name") or "").strip().lower()] = d.get("verdict")
            for d in recomputed["drivers"]:
                d["verdict"] = verdicts.get((d.get("name") or "").strip().lower())
            # Merge sources (dedupe by url).
            seen_urls = set()
            allsrc = []
            for s in (snap.get("sources") or []) + new_sources:
                u = s.get("url")
                if u and u in seen_urls:
                    continue
                seen_urls.add(u)
                allsrc.append(s)
            recomputed["sources"] = allsrc[:14]
            recomputed["period"] = snap.get("period")
            recomputed["ticker"] = ticker
            recomputed["generated_at"] = snap.get("generated_at") or datetime.now(timezone.utc).isoformat()
            recomputed["searched_at"] = datetime.now(timezone.utc).isoformat()
            recomputed["last_query"] = query
            recomputed["coef_history"] = snap.get("coef_history") or []

            await db.theses.update_one(
                {"id": company_id, "user_id": user_id}, {"$set": {"kpi_snapshot": recomputed}})
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "done", "result": recomputed,
                                          "updated_at": datetime.now(timezone.utc).isoformat()}})
        except Exception as e:
            logger.error(f"kpi search job failed ({company_id}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or f"Error buscando KPI: {e}"}})

    @router.post("/{company_id}/kpis/search")
    async def search_kpi(company_id: str, req: KpiSearchRequest, user: Dict[str, Any] = Depends(auth_required)):
        q = (req.query or "").strip()
        if not q:
            raise HTTPException(status_code=400, detail="Escribe qué dato buscar")
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0, "id": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id, "user_id": user["user_id"], "kind": "kpi_search",
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_kpi_search_job(job_id, company_id, user["user_id"], q))
        return {"job_id": job_id}

    # ----- KPI source files (PDF / images / pasted transcript) -----
    async def _run_doc_extract(file_id, user_id, data, ext, mime, company, filename):
        try:
            res = await asyncio.to_thread(_doc_extract_sync, data, ext, mime, company, filename)
            upd = {"status": "ready", "extracted_text": res.get("text") or "",
                   "extracted_at": datetime.now(timezone.utc).isoformat()}
            # Auto-name from the AI-suggested title (user can still rename manually).
            if res.get("title"):
                upd["display_name"] = res["title"]
            rec0 = await db.kpi_files.find_one({"id": file_id, "user_id": user_id}, {"_id": 0, "company_id": 1})
            if rec0:
                sup = await _find_superseded(rec0["company_id"], user_id, upd.get("display_name") or filename, file_id)
                if sup:
                    upd["supersedes"] = sup
            await db.kpi_files.update_one({"id": file_id, "user_id": user_id}, {"$set": upd})
        except Exception as e:
            logger.error(f"doc extract failed ({file_id}): {e}")
            await db.kpi_files.update_one(
                {"id": file_id, "user_id": user_id},
                {"$set": {"status": "error", "error": "No se pudo leer el documento"}})

    async def _find_superseded(company_id, user_id, new_name, exclude_id):
        """If `new_name` is an equivalent-but-newer version of an existing document,
        return {id, name} of the older one it supersedes (closest previous version)."""
        new_fam = _doc_family(new_name)
        if not new_fam:
            return None
        new_rank = _period_rank(new_name)
        cands = await db.kpi_files.find(
            {"company_id": company_id, "user_id": user_id, "is_deleted": False, "id": {"$ne": exclude_id}},
            {"_id": 0, "id": 1, "display_name": 1, "original_filename": 1, "created_at": 1}).to_list(length=30)
        best = None
        for c in cands:
            cname = c.get("display_name") or c.get("original_filename") or ""
            fam = _doc_family(cname)
            union = len(new_fam | fam)
            if not union or (len(new_fam & fam) / union) < 0.6:
                continue  # different kind of document
            crank = _period_rank(cname)
            if new_rank < crank:
                continue  # the new one is OLDER than this → don't flag
            key = (crank, c.get("created_at") or "")
            if best is None or crank > best["rank"] or (crank == best["rank"] and (c.get("created_at") or "") < best["created"]):
                best = {"id": c["id"], "name": cname, "rank": crank, "created": c.get("created_at") or ""}
        return {"id": best["id"], "name": best["name"]} if best else None

    def _file_public(f):
        txt = f.get("extracted_text") or ""
        return {
            "id": f.get("id"), "original_filename": f.get("original_filename"),
            "display_name": f.get("display_name") or f.get("original_filename"),
            "description": f.get("description") or "",
            "content_type": f.get("content_type"), "size": f.get("size"),
            "status": f.get("status"), "selected": f.get("selected", True),
            "kind": f.get("kind", "file"), "created_at": f.get("created_at"),
            "auto_fetched": bool(f.get("auto_fetched")), "source_url": f.get("source_url"),
            "supersedes": f.get("supersedes"),
            "downloadable": bool(f.get("storage_path")),
            "error": f.get("error"), "preview": txt[:180],
            "has_text": bool(txt),
        }

    @router.get("/{company_id}/kpis/files")
    async def list_kpi_files(company_id: str, user: Dict[str, Any] = Depends(auth_required)):
        files = await db.kpi_files.find(
            {"company_id": company_id, "user_id": user["user_id"], "is_deleted": False},
            {"_id": 0}).sort("created_at", -1).to_list(length=50)
        return {"files": [_file_public(f) for f in files]}

    @router.post("/{company_id}/kpis/files")
    async def upload_kpi_file(company_id: str, file: UploadFile = File(...), user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0, "company": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        count = await db.kpi_files.count_documents(
            {"company_id": company_id, "user_id": user["user_id"], "is_deleted": False})
        if count >= KPI_MAX_FILES:
            raise HTTPException(status_code=400, detail=f"Máximo {KPI_MAX_FILES} archivos por empresa. Borra alguno antiguo.")
        ext = (file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "").lower()
        if ext not in KPI_ALLOWED_EXT:
            raise HTTPException(status_code=400, detail="Formato no admitido. Sube PDF o imagen (PNG/JPG/WEBP).")
        data = await file.read()
        if len(data) > KPI_MAX_BYTES:
            raise HTTPException(status_code=400, detail="El archivo supera 100 MB.")
        mime = MIME_TYPES.get(ext, file.content_type or "application/octet-stream")
        fid = uuid.uuid4().hex
        storage_path = f"{APP_NAME}/kpi-files/{user['user_id']}/{fid}.{ext}"
        try:
            res = await asyncio.to_thread(put_object, storage_path, data, mime)
        except Exception as e:
            logger.error(f"storage upload failed: {e}")
            raise HTTPException(status_code=502, detail="No se pudo subir el archivo")
        company = (doc.get("company") or {}).get("name") or company_id
        rec = {
            "id": fid, "user_id": user["user_id"], "company_id": company_id,
            "storage_path": res.get("path", storage_path), "original_filename": file.filename,
            "content_type": mime, "size": len(data), "ext": ext, "kind": "file",
            "status": "processing", "selected": True, "is_deleted": False,
            "extracted_text": "", "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.kpi_files.insert_one(rec)
        _spawn(_run_doc_extract(fid, user["user_id"], data, ext, mime, company, file.filename))
        return {"file": _file_public(rec)}

    @router.post("/{company_id}/kpis/files/transcript")
    async def add_transcript(company_id: str, req: KpiTranscriptRequest, user: Dict[str, Any] = Depends(auth_required)):
        text = (req.text or "").strip()
        if len(text) < 20:
            raise HTTPException(status_code=400, detail="Pega un transcript más completo.")
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0, "id": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        count = await db.kpi_files.count_documents(
            {"company_id": company_id, "user_id": user["user_id"], "is_deleted": False})
        if count >= KPI_MAX_FILES:
            raise HTTPException(status_code=400, detail=f"Máximo {KPI_MAX_FILES} archivos por empresa.")
        fid = uuid.uuid4().hex
        rec = {
            "id": fid, "user_id": user["user_id"], "company_id": company_id,
            "storage_path": None, "original_filename": (req.title or "Transcript").strip()[:80],
            "content_type": "text/plain", "size": len(text.encode()), "ext": "txt", "kind": "transcript",
            "status": "ready", "selected": True, "is_deleted": False,
            "extracted_text": text[:40000], "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.kpi_files.insert_one(rec)
        return {"file": _file_public(rec)}

    @router.patch("/{company_id}/kpis/files/{file_id}")
    async def update_kpi_file(company_id: str, file_id: str, req: KpiFileSelectRequest, user: Dict[str, Any] = Depends(auth_required)):
        upd, unset = {}, {}
        if req.selected is not None:
            upd["selected"] = bool(req.selected)
        if req.display_name is not None:
            upd["display_name"] = req.display_name.strip()[:120]
        if req.description is not None:
            upd["description"] = req.description.strip()[:500]
        if req.dismiss_supersedes:
            unset["supersedes"] = ""
        if not upd and not unset:
            raise HTTPException(status_code=400, detail="Nada que actualizar")
        ops = {}
        if upd:
            ops["$set"] = upd
        if unset:
            ops["$unset"] = unset
        r = await db.kpi_files.update_one(
            {"id": file_id, "company_id": company_id, "user_id": user["user_id"], "is_deleted": False}, ops)
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
        rec = await db.kpi_files.find_one({"id": file_id}, {"_id": 0})
        return {"ok": True, "file": _file_public(rec)}

    @router.delete("/{company_id}/kpis/files/{file_id}")
    async def delete_kpi_file(company_id: str, file_id: str, user: Dict[str, Any] = Depends(auth_required)):
        r = await db.kpi_files.update_one(
            {"id": file_id, "company_id": company_id, "user_id": user["user_id"]},
            {"$set": {"is_deleted": True}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
        return {"ok": True}

    @router.post("/{company_id}/kpis/files/{file_id}/retry")
    async def retry_kpi_file(company_id: str, file_id: str, user: Dict[str, Any] = Depends(auth_required)):
        """Re-run extraction for a document stuck in `error` (or any uploaded file).
        Re-downloads the stored bytes and re-launches the background extractor."""
        rec = await db.kpi_files.find_one(
            {"id": file_id, "company_id": company_id, "user_id": user["user_id"], "is_deleted": False},
            {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
        if not rec.get("storage_path"):
            raise HTTPException(status_code=400, detail="Este documento no se puede reprocesar (sin archivo original).")
        cdoc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0, "company": 1})
        company = ((cdoc or {}).get("company") or {}).get("name") or company_id
        try:
            data, _ctype = await asyncio.to_thread(get_object, rec["storage_path"])
        except Exception as e:
            logger.error(f"retry: storage fetch failed ({file_id}): {e}")
            raise HTTPException(status_code=502, detail="No se pudo recuperar el archivo para reprocesar.")
        await db.kpi_files.update_one(
            {"id": file_id, "user_id": user["user_id"]},
            {"$set": {"status": "processing"}, "$unset": {"error": ""}})
        ext = rec.get("ext") or "pdf"
        mime = rec.get("content_type") or MIME_TYPES.get(ext, "application/octet-stream")
        _spawn(_run_doc_extract(file_id, user["user_id"], data, ext, mime, company, rec.get("original_filename") or "documento"))
        rec["status"] = "processing"
        rec.pop("error", None)
        return {"ok": True, "file": _file_public(rec)}


    async def download_kpi_file(company_id: str, file_id: str, auth: str = Query(None), authorization: str = Header(None), session_token: str = Cookie(None)):
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1]
        elif auth:
            token = auth
        elif session_token:
            token = session_token
        uid = None
        if token:
            sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0, "user_id": 1})
            uid = sess.get("user_id") if sess else None
        rec = await db.kpi_files.find_one({"id": file_id, "company_id": company_id, "is_deleted": False}, {"_id": 0})
        if not rec or rec.get("user_id") != uid:
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
        if not rec.get("storage_path"):
            raise HTTPException(status_code=404, detail="Sin archivo descargable")
        data, ctype = await asyncio.to_thread(get_object, rec["storage_path"])
        fname = (rec.get("display_name") or rec.get("original_filename") or "documento")
        if not fname.lower().endswith(f".{rec.get('ext','')}") and rec.get("ext"):
            fname = f"{fname}.{rec.get('ext')}"
        fname = re.sub(r'[^\w.\- ]', "_", fname)
        return Response(content=data, media_type=rec.get("content_type") or ctype,
                        headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    # ----- KPI qualitative news (inform scores; aged out, refreshed on reanalyze) -----
    def _news_public(n):
        return {
            "id": n.get("id"), "headline": n.get("headline"), "summary": n.get("summary"),
            "why_it_matters": n.get("why_it_matters"), "url": n.get("url"),
            "published_at": n.get("published_at"), "sentiment": n.get("sentiment"),
            "relevance": n.get("relevance"), "effective_relevance": n.get("effective_relevance"),
            "driver": n.get("driver"), "origin": n.get("origin"), "created_at": n.get("created_at"),
        }

    async def _news_merge_prune(company_id, user_id, ticker, new_items, origin):
        return await merge_prune_news(db, company_id, user_id, ticker, new_items, origin)

    async def _load_company_news(company_id, user_id):
        alln = await db.kpi_news.find(
            {"company_id": company_id, "user_id": user_id, "is_deleted": False}, {"_id": 0}).to_list(length=200)
        kept, _ = prune_news(alln, datetime.now(timezone.utc))
        return kept

    @router.get("/{company_id}/kpis/news")
    async def list_kpi_news(company_id: str, user: Dict[str, Any] = Depends(auth_required)):
        kept = await _load_company_news(company_id, user["user_id"])
        return {"news": [_news_public(n) for n in kept]}

    async def _run_kpi_news_job(job_id, company_id, user_id, query):
        try:
            doc = await db.theses.find_one(
                {"id": company_id, "user_id": user_id, "type": "company"}, {"_id": 0})
            if not doc:
                await db.thesis_jobs.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Empresa no encontrada"}})
                return
            company = (doc.get("company") or {}).get("name") or company_id
            ticker = (doc.get("company") or {}).get("ticker") or ""
            drivers = _company_drivers(doc)
            fresh = await asyncio.to_thread(_news_sync, company, ticker, drivers, query or None)
            kept = await _news_merge_prune(company_id, user_id, ticker, fresh, "news_search")
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": {"news": [_news_public(n) for n in kept], "found": len(fresh)},
                          "updated_at": datetime.now(timezone.utc).isoformat()}})
        except Exception as e:
            logger.error(f"kpi news job failed ({company_id}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id}, {"$set": {"status": "error", "error": _friendly_err(e) or "Error buscando noticias"}})

    @router.post("/{company_id}/kpis/news")
    async def search_kpi_news(company_id: str, req: KpiNewsRequest, user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one(
            {"id": company_id, "user_id": user["user_id"], "type": "company"}, {"_id": 0, "id": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        await db.thesis_jobs.insert_one({
            "id": job_id, "user_id": user["user_id"], "kind": "kpi_news",
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _spawn(_run_kpi_news_job(job_id, company_id, user["user_id"], (req.query or "").strip() or None))
        return {"job_id": job_id}

    @router.delete("/{company_id}/kpis/news/{news_id}")
    async def delete_kpi_news(company_id: str, news_id: str, user: Dict[str, Any] = Depends(auth_required)):
        r = await db.kpi_news.update_one(
            {"id": news_id, "company_id": company_id, "user_id": user["user_id"]},
            {"$set": {"is_deleted": True}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Noticia no encontrada")
        return {"ok": True}



    @router.get("/{thesis_id}")
    async def get_thesis(thesis_id: str, user: Dict[str, Any] = Depends(auth_required)):
        doc = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"]}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        # Self-heal: drop split_dev entries whose developed thesis no longer exists
        # (e.g. the user deleted that developed sub-thesis), so this company's
        # suggestions page shows the core/split as "pendiente" again and it can be
        # regenerated. Restoring the deleted thesis (Undo) brings the entry back.
        if doc.get("type") == "company" and doc.get("split_dev"):
            dev_ids = [e.get("developed_id") for e in doc["split_dev"] if e.get("developed_id")]
            if dev_ids:
                alive_docs = await db.theses.find(
                    {"id": {"$in": dev_ids}, "user_id": user["user_id"]}, {"_id": 0, "id": 1}
                ).to_list(length=500)
                pruned = prune_stale_split_dev(doc["split_dev"], {d["id"] for d in alive_docs})
                if len(pruned) != len(doc["split_dev"]):
                    doc["split_dev"] = pruned
                    await db.theses.update_one(
                        {"id": thesis_id, "user_id": user["user_id"]},
                        {"$set": {"split_dev": pruned}},
                    )
        # Backfill the frozen TAM Score for older trend theses generated before it was
        # stored, so they show values without needing a manual refresh (cache-only).
        if doc.get("type") == "trend" and any(
            c.get("tam_score") is None for c in (doc.get("companies") or []) if c.get("ticker")
        ):
            try:
                await recompute_and_store_tam(db, user["user_id"], [thesis_id])
                fresh = await db.theses.find_one({"id": thesis_id, "user_id": user["user_id"]}, {"_id": 0, "companies": 1})
                if fresh and fresh.get("companies") is not None:
                    doc["companies"] = fresh["companies"]
            except Exception as e:
                logger.warning(f"tam backfill on read failed ({thesis_id}): {e}")
        # Planning is editable (merge/split markers) only before the plan is executed.
        if doc.get("type") == "company":
            doc["planning_locked"] = await _company_locked(user["user_id"], thesis_id, doc.get("split_dev"))
            # In-flight generations launched FROM this company (plan execution still
            # running): exposed so the UI can keep polling until the whole plan finishes
            # instead of only waiting on the first job.
            doc["inflight_count"] = await db.thesis_jobs.count_documents({
                "user_id": user["user_id"], "kind": "generate",
                "status": {"$in": ["processing", "queued"]},
                "params.from_company": thesis_id,
            })
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

    @router.put("/{thesis_id}/parent")
    async def assign_parent(thesis_id: str, req: AssignParentRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Nest a thesis under a broader 'mother' thesis (or clear it). A child's TAM is
        excluded from megatrend aggregates so overlapping markets aren't double-counted."""
        uid = user["user_id"]
        thesis = await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0, "id": 1})
        if not thesis:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        pid = (req.parent_id or "").strip() or None
        if pid:
            if pid == thesis_id:
                raise HTTPException(status_code=400, detail="Una tesis no puede ser su propia madre")
            parent = await db.theses.find_one(
                {"id": pid, "user_id": uid, "type": "trend"}, {"_id": 0, "id": 1, "parent_id": 1})
            if not parent:
                raise HTTPException(status_code=404, detail="Tesis madre no encontrada")
            if parent.get("parent_id") == thesis_id:
                raise HTTPException(status_code=400, detail="Relación circular: esa tesis ya es hija de esta")
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"parent_id": pid}})
        return {"ok": True, "parent_id": pid}

    @router.post("/{thesis_id}/split-developed")
    async def record_split_developed(thesis_id: str, req: SplitDevelopedRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Record (informational, persisted) that a core thesis on a company suggestions
        page was developed by parts: either a specific split, or the whole core. Lets the
        page show a note + the remaining (pending) splits as their own cards."""
        uid = user["user_id"]
        company = await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0, "id": 1, "split_dev": 1})
        if not company:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        entry = {
            "core": req.core,
            "split": None if req.whole else (req.split or None),
            "developed_id": req.developed_id,
            "whole": bool(req.whole),
        }
        existing = company.get("split_dev") or []
        existing = [
            e for e in existing
            if not (e.get("core") == entry["core"] and bool(e.get("whole")) == entry["whole"] and e.get("split") == entry["split"])
        ]
        existing.append(entry)
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"split_dev": existing}})
        return {"ok": True, "split_dev": existing}

    @router.post("/{thesis_id}/plan")
    async def set_plan(thesis_id: str, req: SetPlanRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Planning phase: mark a driver to be generated as the whole ('whole') or as all
        its partitions ('split'). Pure metadata — no generation, no LLM. Returns the
        updated company thesis."""
        uid = user["user_id"]
        nrm = lambda s: (s or "").strip().lower()  # noqa: E731
        doc = await db.theses.find_one({"id": thesis_id, "user_id": uid, "type": "company"}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        if await _company_locked(uid, thesis_id, doc.get("split_dev")):
            raise HTTPException(status_code=409, detail="La planificación está cerrada (ya ejecutaste el plan).")
        plan = (req.plan or "").strip().lower()
        if plan not in ("whole", "split"):
            raise HTTPException(status_code=400, detail="plan debe ser 'whole' o 'split'")
        trends = doc.get("trends") or []
        drv = next((t for t in trends if nrm(t.get("name")) == nrm(req.core)), None)
        if not drv:
            raise HTTPException(status_code=404, detail="Driver no encontrado")
        if plan == "split" and not (drv.get("splits") or []):
            raise HTTPException(status_code=400, detail="Este driver no se puede partir")
        drv["plan"] = plan
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"trends": trends}})
        return await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0})

    @router.post("/{thesis_id}/generate-plan")
    async def generate_plan(thesis_id: str, user: Dict[str, Any] = Depends(auth_required)):
        """Execute (or RESUME) the plan: enqueue a generation for every driver that is
        not merged away, per its marker ('whole' → 1 thesis; 'split' → all partitions),
        SKIPPING the ones already developed or with an in-flight job. All queued (serial),
        each anchored to its frozen partition slice. Idempotent → safe to re-run to
        recover failed/interrupted generations. Locks planning."""
        uid = user["user_id"]
        nrm = lambda s: (s or "").strip().lower()  # noqa: E731
        doc = await db.theses.find_one({"id": thesis_id, "user_id": uid, "type": "company"}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        # What is already developed (from split_dev) and what is currently in-flight,
        # so a resume run doesn't duplicate work.
        dev = doc.get("split_dev") or []
        whole_done = {nrm(e.get("core")) for e in dev if e.get("whole")}
        split_done = {(nrm(e.get("core")), nrm(e.get("split"))) for e in dev if not e.get("whole") and e.get("split")}
        inflight = await db.thesis_jobs.find(
            {"user_id": uid, "kind": "generate", "status": {"$in": ["processing", "queued"]},
             "params.from_company": thesis_id},
            {"_id": 0, "params": 1},
        ).to_list(length=500)
        inflight_keys = {(nrm((j.get("params") or {}).get("core")), nrm((j.get("params") or {}).get("subject"))) for j in inflight}

        count, first = 0, None
        for drv in (doc.get("trends") or []):
            if drv.get("merged_into"):
                continue  # folded into another driver → its TAM travels there
            name = drv.get("name")
            n = nrm(name)
            if (drv.get("plan") == "split") and (drv.get("splits") or []):
                for sp in drv["splits"]:
                    sn = sp.get("name")
                    key = (n, nrm(sn))
                    if key in split_done or key in inflight_keys:
                        continue
                    jid, _st, _a = await _enqueue_generation(
                        uid, "trend", sn, from_company=thesis_id, core=name, develop_whole=False)
                    count += 1
                    first = first or jid
            else:
                if n in whole_done or (n, n) in inflight_keys:
                    continue
                jid, _st, _a = await _enqueue_generation(
                    uid, "trend", name, from_company=thesis_id, core=name, develop_whole=True)
                count += 1
                first = first or jid
        if count == 0:
            raise HTTPException(status_code=400, detail="No hay drivers pendientes que generar.")
        return {"ok": True, "count": count, "first_job_id": first}

    @router.post("/{thesis_id}/merge")
    async def merge_thesis(thesis_id: str, req: MergeThesisRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Manually fold a minor/complementary proposed thesis (source) into another
        (target) on a company suggestions page. REVERSIBLE: the source proposal is
        flagged `merged_into` (not deleted) and, if it was already developed, the
        company is removed from those developed trend theses and the removed entries
        are saved on the source (`merged_removed`) so /unmerge can restore everything.
        Returns the updated company thesis document."""
        uid = user["user_id"]
        nrm = lambda s: (s or "").strip().lower()  # noqa: E731
        doc = await db.theses.find_one({"id": thesis_id, "user_id": uid, "type": "company"}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        if await _company_locked(uid, thesis_id, doc.get("split_dev")):
            raise HTTPException(status_code=409, detail="La planificación está cerrada (ya ejecutaste el plan).")
        trends = doc.get("trends") or []
        nsrc, ntgt = nrm(req.source), nrm(req.target)
        if nsrc == ntgt:
            raise HTTPException(status_code=400, detail="Una tesis no puede fusionarse consigo misma")
        src = next((t for t in trends if nrm(t.get("name")) == nsrc), None)
        if not src:
            raise HTTPException(status_code=404, detail="No se encontró la tesis origen")
        if src.get("merged_into"):
            raise HTTPException(status_code=400, detail="Esa tesis ya está fusionada")
        # Target must be another PROPOSAL in this same plan (additive merge: its TAM
        # is summed into the destination). Sibling drivers are mutually exclusive by
        # construction, so merging just consolidates two exclusive slices.
        tgt = next((t for t in trends if nrm(t.get("name")) == ntgt), None)
        if not tgt:
            raise HTTPException(status_code=404, detail="No se encontró la tesis destino")
        if tgt.get("merged_into"):
            raise HTTPException(status_code=400, detail="No puedes fusionar en una tesis que ya está fusionada")
        target_label = tgt.get("name")

        # If the source was already developed, remove the company from each developed
        # trend thesis and remember what we removed (for a clean revert).
        ticker = ((doc.get("company") or {}).get("ticker") or "").upper().strip()
        removed: List[Dict[str, Any]] = []
        for e in (doc.get("split_dev") or []):
            if nrm(e.get("core")) != nsrc:
                continue
            did = e.get("developed_id")
            if not did:
                continue
            tdoc = await db.theses.find_one({"id": did, "user_id": uid, "type": "trend"}, {"_id": 0, "id": 1, "companies": 1})
            if not tdoc:
                continue
            kept, removed_entry = [], None
            for c in (tdoc.get("companies") or []):
                if ticker and (c.get("ticker") or "").upper().strip() == ticker:
                    removed_entry = c
                else:
                    kept.append(c)
            if removed_entry is not None:
                await db.theses.update_one({"id": did, "user_id": uid}, {"$set": {"companies": kept}})
                removed.append({"thesis_id": did, "entry": removed_entry})

        for t in trends:
            if nrm(t.get("name")) == nsrc:
                t["merged_into"] = target_label
                t["merged_removed"] = removed
                t.pop("covered", None)
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"trends": trends}})
        await recompute_and_store_tam(db, uid)
        return await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0})

    @router.post("/{thesis_id}/unmerge")
    async def unmerge_thesis(thesis_id: str, req: UnmergeThesisRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Revert a previous /merge: clear the `merged_into` flag and re-insert the
        company into the developed trend theses it was removed from. Returns the
        updated company thesis document."""
        uid = user["user_id"]
        nrm = lambda s: (s or "").strip().lower()  # noqa: E731
        doc = await db.theses.find_one({"id": thesis_id, "user_id": uid, "type": "company"}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        trends = doc.get("trends") or []
        nsrc = nrm(req.source)
        src = next((t for t in trends if nrm(t.get("name")) == nsrc), None)
        if not src:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        for r in (src.get("merged_removed") or []):
            did, entry = r.get("thesis_id"), r.get("entry")
            if not did or not entry:
                continue
            tdoc = await db.theses.find_one({"id": did, "user_id": uid}, {"_id": 0, "id": 1, "companies": 1})
            if not tdoc:
                continue
            tk = (entry.get("ticker") or "").upper().strip()
            comps = [c for c in (tdoc.get("companies") or []) if (c.get("ticker") or "").upper().strip() != tk]
            comps.append(entry)
            await db.theses.update_one({"id": did, "user_id": uid}, {"$set": {"companies": comps}})
        for t in trends:
            if nrm(t.get("name")) == nsrc:
                t.pop("merged_into", None)
                t.pop("merged_removed", None)
                t.pop("covered", None)
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"trends": trends}})
        await recompute_and_store_tam(db, uid)
        return await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0})

    @router.post("/{thesis_id}/merge-thesis")
    async def merge_thesis_by_id(thesis_id: str, req: MergeThesisByIdRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Fase B (control manual): fold an already-developed trend thesis (source)
        into another developed thesis (target) for THIS company. Removes the company
        from the source thesis (it stays a member of the target) and records the
        removal on the company doc (`thesis_merges`) so /unmerge-thesis can restore it.
        Targets are always theses the company already belongs to, so it is never
        orphaned. Returns the updated company thesis document."""
        uid = user["user_id"]
        if req.source_thesis_id == req.target_thesis_id:
            raise HTTPException(status_code=400, detail="Una tesis no puede fusionarse consigo misma")
        co = await db.theses.find_one({"id": thesis_id, "user_id": uid, "type": "company"}, {"_id": 0})
        if not co:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        ticker = ((co.get("company") or {}).get("ticker") or "").upper().strip()
        if not ticker:
            raise HTTPException(status_code=400, detail="La empresa no tiene ticker")
        src = await db.theses.find_one({"id": req.source_thesis_id, "user_id": uid, "type": "trend"}, {"_id": 0, "id": 1, "title": 1, "companies": 1, "value_chain": 1})
        tgt = await db.theses.find_one({"id": req.target_thesis_id, "user_id": uid, "type": "trend"}, {"_id": 0, "id": 1, "title": 1, "companies": 1})
        if not src or not tgt:
            raise HTTPException(status_code=404, detail="No se encontró la tesis origen o destino")
        merges = co.get("thesis_merges") or []
        if any(m.get("source_thesis_id") == req.source_thesis_id for m in merges):
            raise HTTPException(status_code=400, detail="Esa tesis ya está fusionada")
        kept, removed = [], None
        for c in (src.get("companies") or []):
            if (c.get("ticker") or "").upper().strip() == ticker:
                removed = c
            else:
                kept.append(c)
        if removed is None:
            raise HTTPException(status_code=400, detail="La empresa no está en la tesis origen")
        await db.theses.update_one({"id": req.source_thesis_id, "user_id": uid}, {"$set": {"companies": kept}})

        # TAM absorption: credit the company's addressable market in the SOURCE thesis
        # to its entry in the TARGET thesis (per-company, so only this company's TAM
        # Score grows). Conserves the company's total potential across theses.
        absorbed = stage_tam_for_role(removed.get("value_chain_role"), src.get("value_chain")) or 0
        if absorbed:
            tcomps = tgt.get("companies") or []
            for c in tcomps:
                if (c.get("ticker") or "").upper().strip() == ticker:
                    c["absorbed_tam_busd"] = round((c.get("absorbed_tam_busd") or 0) + absorbed, 1)
                    break
            await db.theses.update_one({"id": req.target_thesis_id, "user_id": uid}, {"$set": {"companies": tcomps}})

        merges.append({
            "source_thesis_id": src["id"], "source_title": src.get("title"),
            "target_thesis_id": tgt["id"], "target_title": tgt.get("title"),
            "removed_entry": removed,
            "absorbed_tam_busd": absorbed,
        })
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"thesis_merges": merges}})
        await recompute_and_store_tam(db, uid)
        return await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0})

    @router.post("/{thesis_id}/unmerge-thesis")
    async def unmerge_thesis_by_id(thesis_id: str, req: UnmergeThesisByIdRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Revert a Fase B merge: re-insert the company into the source trend thesis
        and drop the `thesis_merges` marker. Returns the updated company doc."""
        uid = user["user_id"]
        co = await db.theses.find_one({"id": thesis_id, "user_id": uid, "type": "company"}, {"_id": 0})
        if not co:
            raise HTTPException(status_code=404, detail="Tesis de empresa no encontrada")
        merges = co.get("thesis_merges") or []
        m = next((x for x in merges if x.get("source_thesis_id") == req.source_thesis_id), None)
        if not m:
            raise HTTPException(status_code=404, detail="Fusión no encontrada")
        entry = m.get("removed_entry")
        if entry:
            sdoc = await db.theses.find_one({"id": req.source_thesis_id, "user_id": uid}, {"_id": 0, "id": 1, "companies": 1})
            if sdoc:
                tk = (entry.get("ticker") or "").upper().strip()
                comps = [c for c in (sdoc.get("companies") or []) if (c.get("ticker") or "").upper().strip() != tk]
                comps.append(entry)
                await db.theses.update_one({"id": req.source_thesis_id, "user_id": uid}, {"$set": {"companies": comps}})

        # Reverse the TAM absorption on the target thesis (subtract what was credited).
        absorbed = m.get("absorbed_tam_busd") or 0
        target_id = m.get("target_thesis_id")
        if absorbed and target_id:
            tk = ((entry or {}).get("ticker") or "").upper().strip()
            tdoc = await db.theses.find_one({"id": target_id, "user_id": uid}, {"_id": 0, "id": 1, "companies": 1})
            if tdoc:
                tcomps = tdoc.get("companies") or []
                for c in tcomps:
                    if (c.get("ticker") or "").upper().strip() == tk:
                        newv = round((c.get("absorbed_tam_busd") or 0) - absorbed, 1)
                        if newv > 0:
                            c["absorbed_tam_busd"] = newv
                        else:
                            c.pop("absorbed_tam_busd", None)
                        break
                await db.theses.update_one({"id": target_id, "user_id": uid}, {"$set": {"companies": tcomps}})
        merges = [x for x in merges if x.get("source_thesis_id") != req.source_thesis_id]
        await db.theses.update_one({"id": thesis_id, "user_id": uid}, {"$set": {"thesis_merges": merges}})
        await recompute_and_store_tam(db, uid)
        return await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0})

    @router.get("/radar/status")
    async def radar_status(user: Dict[str, Any] = Depends(auth_required)):
        from radar import compute_next_send_at  # local import: avoid cycle on startup
        u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "radar": 1})
        r = (u or {}).get("radar") or {}
        weekday = int(r.get("weekday", 0))
        hour_utc = int(r.get("hour_utc", 7))
        next_at = compute_next_send_at(weekday, hour_utc) if r.get("enabled") else None
        return {
            "enabled": bool(r.get("enabled")),
            "weekday": weekday,
            "hour_utc": hour_utc,
            "last_sent_at": r.get("last_sent_at"),
            "next_send_at": next_at,
        }

    @router.post("/radar/subscribe")
    async def radar_subscribe(req: RadarSubscribeRequest, user: Dict[str, Any] = Depends(auth_required)):
        u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "radar": 1})
        cur = (u or {}).get("radar") or {}
        new = {
            "enabled": bool(req.enabled),
            "weekday": int(req.weekday) if req.weekday is not None else int(cur.get("weekday", 0)),
            "hour_utc": int(req.hour_utc) if req.hour_utc is not None else int(cur.get("hour_utc", 7)),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if "last_sent_at" in cur:
            new["last_sent_at"] = cur["last_sent_at"]
        # Sanity clamp.
        new["weekday"] = max(0, min(6, new["weekday"]))
        new["hour_utc"] = max(0, min(23, new["hour_utc"]))
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"radar": new}})
        return await radar_status(user)

    @router.post("/radar/send-now")
    async def radar_send_now(user: Dict[str, Any] = Depends(auth_required)):
        """One-off manual send (does NOT alter the user's weekly schedule). Spawns a
        background job that re-uses the cached trend discovery (if recent <6 days)
        and runs a fresh per-user news_watch. Returns immediately with job_id."""
        from radar import run_radar_for_user
        job_id = f"radarsend_{uuid.uuid4().hex[:12]}"
        await db.thesis_jobs.insert_one({
            "id": job_id, "kind": "radar_send_now", "user_id": user["user_id"],
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        async def _run():
            try:
                res = await run_radar_for_user(db, user["user_id"])
                await db.thesis_jobs.update_one(
                    {"id": job_id},
                    {"$set": {"status": "done", "result": res,
                              "updated_at": datetime.now(timezone.utc).isoformat()}},
                )
            except Exception as e:
                logger.error(f"radar send-now job {job_id} failed: {e}")
                await db.thesis_jobs.update_one(
                    {"id": job_id}, {"$set": {"status": "error", "error": str(e)}},
                )
        _spawn(_run())
        return {"job_id": job_id, "status": "pending"}

    @router.post("/refresh/run")
    async def refresh_run(req: RefreshRunRequest, user: Dict[str, Any] = Depends(auth_required)):
        """Manual data refresh (no LLM): re-fetch fundamentals for the scoped tickers
        and recompute the frozen TAM Scores across all the user's trend theses, so the
        fresh data flows both ways (company ↔ theses). Scope:
        - thesis_id (trend): refresh all its companies + the whole thesis.
        - thesis_id (company) or ticker: refresh that company across every thesis it
          belongs to (each link and company).
        - neither: refresh everything the user has."""
        uid = user["user_id"]
        tickers: set = set()
        primary = None  # a trend thesis id to return refreshed
        if req.thesis_id:
            doc = await db.theses.find_one({"id": req.thesis_id, "user_id": uid}, {"_id": 0, "type": 1, "companies": 1, "company": 1})
            if not doc:
                raise HTTPException(status_code=404, detail="Tesis no encontrada")
            if doc.get("type") == "trend":
                primary = req.thesis_id
                tickers = {(c.get("ticker") or "").upper().strip() for c in (doc.get("companies") or []) if c.get("ticker")}
            else:
                tk = ((doc.get("company") or {}).get("ticker") or "").upper().strip()
                if tk:
                    req.ticker = tk
        if req.ticker:
            tk = req.ticker.upper().strip()
            related = await db.theses.find(
                {"user_id": uid, "type": "trend", "companies.ticker": tk}, {"_id": 0, "companies": 1}
            ).to_list(length=500)
            tickers.add(tk)
            for d in related:
                for c in (d.get("companies") or []):
                    t = (c.get("ticker") or "").upper().strip()
                    if t:
                        tickers.add(t)
        if not req.thesis_id and not req.ticker:
            allt = await db.theses.find({"user_id": uid, "type": "trend"}, {"_id": 0, "companies": 1}).to_list(length=2000)
            for d in allt:
                for c in (d.get("companies") or []):
                    t = (c.get("ticker") or "").upper().strip()
                    if t:
                        tickers.add(t)
        res = await refresh_user_data(db, uid, tickers)
        out = {"ok": True, "tickers_refreshed": res["tickers_refreshed"], "last_refresh_at": res["last_refresh_at"]}
        if primary:
            out["thesis"] = await db.theses.find_one({"id": primary, "user_id": uid}, {"_id": 0})
        return out

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
        uid = user["user_id"]
        doc = await db.theses.find_one({"id": thesis_id, "user_id": uid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Tesis no encontrada")
        deleted_ids = [thesis_id]
        # Deleting a COMPANY thesis = "start from 0": also delete every trend thesis
        # that was developed FROM this company (its split_dev → developed_id). Other
        # companies in those theses lose that line (their sum TAM drops accordingly)
        # and the theme reverts to "pendiente de generar" in their files.
        if doc.get("type") == "company":
            dev_ids = [e.get("developed_id") for e in (doc.get("split_dev") or []) if e.get("developed_id")]
            if dev_ids:
                await db.theses.delete_many({"id": {"$in": dev_ids}, "user_id": uid})
                deleted_ids += dev_ids
        await db.theses.delete_one({"id": thesis_id, "user_id": uid})
        return {"ok": True, "deleted_ids": deleted_ids}

    return router


from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import yfinance as yf
import pandas as pd
from auth import make_router as make_auth_router
import fx as fx_service
from screener import run_screener
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Valuation Studio API")
api_router = APIRouter(prefix="/api")
auth_router, _auth_required, _auth_optional = make_auth_router(db)
api_router.include_router(auth_router)

from routes.thesis import make_router as make_thesis_router
api_router.include_router(make_thesis_router(db, _auth_required, _auth_optional))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CACHE_TTL_HOURS = 6



# ---------------------- Valuation logic (extracted to services/valuation.py) ----------------------
from services.valuation import (
    fetch_fundamentals_sync,
    compute_custom_ratios,
    _safe_float,
    _cagr,
)


# ---------------------- Models ----------------------

class CalcInputs(BaseModel):
    revenue_2y: Optional[float] = None
    fcf_2y: Optional[float] = None
    shares_outstanding: Optional[float] = None
    gross_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    net_debt: Optional[float] = None
    market_cap: Optional[float] = None
    revenue_cagr_4y: Optional[float] = None
    fcf_cagr_4y: Optional[float] = None
    current_price: Optional[float] = None


# ---------------------- Routes ----------------------

@api_router.get("/")
async def root():
    return {"message": "Valuation Studio API", "version": "1.0"}


@api_router.get("/company/{ticker}")
async def get_company(ticker: str, refresh: bool = False):
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker required")

    # Cache lookup
    cached = await db.fundamentals.find_one({"ticker": ticker}, {"_id": 0})
    if cached and not refresh:
        try:
            as_of = datetime.fromisoformat(cached["data"]["as_of"])
            if datetime.now(timezone.utc) - as_of < timedelta(hours=CACHE_TTL_HOURS):
                data = cached["data"]
                # Recompute ratios fresh from auto values (in case formula changes)
                ratios = compute_custom_ratios({
                    "revenue_2y": data["auto_projections"]["revenue_2y"],
                    "fcf_2y": data["auto_projections"]["fcf_2y"],
                    "shares_outstanding": data["shares_outstanding"],
                    "gross_margin": data["gross_margin"],
                    "operating_margin": data["operating_margin"],
                    "net_debt": data["net_debt"],
                    "market_cap": data["market_cap"],
                    "revenue_cagr_4y": data["auto_projections"]["revenue_cagr_4y"],
                    "fcf_cagr_4y": data["auto_projections"]["fcf_cagr_4y"],
                    "current_price": data["current_price"],
                })
                data["custom_ratios"] = ratios
                return data
        except Exception:
            pass

    try:
        payload = await run_in_threadpool(fetch_fundamentals_sync, ticker)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error fetching {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Upstream data error: {e}")

    # Compute initial ratios
    ratios = compute_custom_ratios({
        "revenue_2y": payload["auto_projections"]["revenue_2y"],
        "fcf_2y": payload["auto_projections"]["fcf_2y"],
        "shares_outstanding": payload["shares_outstanding"],
        "gross_margin": payload["gross_margin"],
        "operating_margin": payload["operating_margin"],
        "net_debt": payload["net_debt"],
        "market_cap": payload["market_cap"],
        "revenue_cagr_4y": payload["auto_projections"]["revenue_cagr_4y"],
        "fcf_cagr_4y": payload["auto_projections"]["fcf_cagr_4y"],
        "current_price": payload["current_price"],
    })
    payload["custom_ratios"] = ratios

    await db.fundamentals.update_one(
        {"ticker": ticker},
        {"$set": {"ticker": ticker, "data": payload, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return payload


@api_router.get("/fx/rates")
async def fx_rates():
    """Latest FX rates (base = USD). Cached 6h server-side."""
    rates = await fx_service.get_rates()
    return {"base": "USD", "rates": rates, "count": len(rates)}


@api_router.post("/admin/run-screener")
async def admin_run_screener():
    """Manual trigger for the nightly screener — useful for QA."""
    async def _fetch(ticker: str, force_refresh: bool = False):
        # Reuse the same pipeline as GET /company/{ticker}
        try:
            payload = await run_in_threadpool(fetch_fundamentals_sync, ticker)
            await db.fundamentals.update_one(
                {"ticker": ticker.upper()},
                {"$set": {"ticker": ticker.upper(), "data": payload, "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            return payload
        except Exception as e:
            logger.warning(f"fetch_fundamentals_sync({ticker}) failed: {e}")
            cached = await db.fundamentals.find_one({"ticker": ticker.upper()}, {"_id": 0})
            return cached.get("data") if cached else None

    return {"ok": True, **(await run_screener(db, _fetch, compute_custom_ratios))}


@api_router.post("/company/{ticker}/calculate")
async def recalculate(ticker: str, inputs: CalcInputs):
    """Recompute custom ratios with user-overridden inputs."""
    return compute_custom_ratios(inputs.model_dump())


@api_router.get("/company/{ticker}/ratio-history")
async def ratio_history(ticker: str):
    """Returns yearly historical Ratio Compra / Ratio Venta + closing price.

    The user's POC formula needs forward-looking inputs (revenue_2y, fcf_2y,
    CAGRs). For history we approximate them by using:
      • year-N revenue → as `revenue_2y` proxy
      • year-N FCF     → as `fcf_2y` proxy
      • current shares + current margins (Yahoo doesn't expose clean historical
        margin series in `info`; using current is acceptable as a first
        approximation — the trend dominates).
      • that year's market cap = year-end close × current shares (we assume
        shares haven't changed dramatically; approximate but consistent).
      • CAGRs computed from the available history slice ending at year N.

    The point of this endpoint is to plot the TREND of POC vs price together,
    not to produce a precise ratio per year. The user can spot if a falling
    Ratio Compra coincides with a falling price (value-trap signal) or with
    rising fundamentals.
    """
    ticker = ticker.upper().strip()
    cached_company = await db.fundamentals.find_one({"ticker": ticker}, {"_id": 0})
    if not cached_company:
        raise HTTPException(status_code=404, detail="Company not loaded yet — open it first.")
    data = cached_company.get("data", {})

    rev_hist = data.get("revenue_history") or []
    fcf_hist = data.get("fcf_history") or []
    shares = data.get("shares_outstanding")
    gross_m = data.get("gross_margin") or 0.0
    op_m = data.get("operating_margin") or 0.0
    cur_net_debt = data.get("net_debt") or 0.0

    if not rev_hist or not fcf_hist or not shares or shares <= 0:
        return {"ticker": ticker, "series": [], "note": "Datos históricos insuficientes."}

    # Fetch historical year-end prices via yfinance.
    def _fetch_close():
        t = yf.Ticker(ticker)
        try:
            hist = t.history(period="max", interval="1mo", auto_adjust=True)
            return hist
        except Exception as e:
            logger.warning(f"history fetch failed for {ticker}: {e}")
            return pd.DataFrame()

    hist = await run_in_threadpool(_fetch_close)
    if hist is None or hist.empty:
        return {"ticker": ticker, "series": [], "note": "Histórico de precios no disponible."}

    # Year-end close per calendar year (use last available month of the year)
    closes_by_year: Dict[int, float] = {}
    try:
        for idx, row in hist.iterrows():
            yr = idx.year if hasattr(idx, "year") else None
            close = _safe_float(row.get("Close"))
            if yr is None or close is None:
                continue
            closes_by_year[yr] = close  # last write wins → latest month of that year
    except Exception as e:
        logger.warning(f"price aggregation failed for {ticker}: {e}")

    # Build the series. Walk rev_hist (ascending) and pair with FCF at same year.
    series = []
    rev_by_year = {int(str(p["date"])[:4]): p["value"] for p in rev_hist if p.get("value") is not None}
    fcf_by_year = {int(str(p["date"])[:4]): p["value"] for p in fcf_hist if p.get("value") is not None}
    years = sorted(set(rev_by_year.keys()) & set(fcf_by_year.keys()))

    for yr in years:
        rev = rev_by_year[yr]
        fcf = fcf_by_year[yr]
        price = closes_by_year.get(yr)
        if price is None or price <= 0:
            continue
        mcap = price * shares

        # CAGR-style growth from the earliest available year up to this one
        rev_cagr = None
        fcf_cagr = None
        earlier_years = [y for y in years if y < yr]
        if earlier_years:
            y0 = earlier_years[0]
            span = yr - y0
            rev_cagr = _cagr([rev_by_year[y0], rev], span) if span >= 1 else None
            fcf_cagr = _cagr([fcf_by_year[y0], fcf], span) if span >= 1 else None
        # Sensible fallbacks: 0% (flat) so the formula still produces a value
        if rev_cagr is None:
            rev_cagr = 0.0
        if fcf_cagr is None:
            fcf_cagr = 0.0

        # Use that year's revenue/FCF as a proxy for the "2y forward" inputs.
        ratios = compute_custom_ratios({
            "revenue_2y": rev,
            "fcf_2y": fcf,
            "shares_outstanding": shares,
            "gross_margin": gross_m,
            "operating_margin": op_m,
            "net_debt": cur_net_debt,
            "market_cap": mcap,
            "revenue_cagr_4y": rev_cagr,
            "fcf_cagr_4y": fcf_cagr,
            "current_price": price,
        })
        series.append({
            "year": yr,
            "price": price,
            "ratio_compra_pct": ratios.get("ratio_compra_pct"),
            "ratio_venta_pct": ratios.get("ratio_venta_pct"),
            "poc": ratios.get("poc"),
            "pov": ratios.get("pov"),
        })

    return {"ticker": ticker, "series": series}


@api_router.get("/company/{ticker}/translate-summary")
async def translate_summary(ticker: str):
    """Translate the company's long_business_summary to Spanish via LLM.
    Cached forever per ticker+source_hash because the source rarely changes
    and the Yahoo English text is essentially immutable per company.
    """
    ticker = ticker.upper().strip()
    cached_company = await db.fundamentals.find_one({"ticker": ticker}, {"_id": 0})
    if not cached_company:
        raise HTTPException(status_code=404, detail="Company not loaded yet — open it first.")
    source_en = cached_company.get("data", {}).get("long_business_summary") or ""
    if not source_en.strip():
        return {"ticker": ticker, "summary_es": "", "source_hash": None, "cached": False}

    # Hard truncate to keep per-call cost under the Emergent LLM key budget ($0.001).
    # ~1400 chars covers the typical Yahoo summary; longer ones get a clean cut at sentence boundary.
    MAX_CHARS = 1400
    if len(source_en) > MAX_CHARS:
        cut = source_en[:MAX_CHARS]
        last_period = cut.rfind(". ")
        source_en = (cut[:last_period + 1] if last_period > 500 else cut) + " […]"

    import hashlib
    source_hash = hashlib.sha256(source_en.encode("utf-8")).hexdigest()[:16]

    existing = await db.translations.find_one({"ticker": ticker, "source_hash": source_hash}, {"_id": 0})
    if existing and existing.get("summary_es"):
        return {"ticker": ticker, "summary_es": existing["summary_es"], "source_hash": source_hash, "cached": True}

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ["EMERGENT_LLM_KEY"]
        chat = LlmChat(
            api_key=api_key,
            session_id=f"translate-{ticker}-{source_hash}",
            system_message=(
                "Eres un traductor financiero profesional. Traduce textos del inglés al español de España "
                "de forma natural y precisa, manteniendo terminología financiera estándar (revenue → ingresos, "
                "free cash flow → flujo de caja libre, etc.). No añadas notas, explicaciones ni comentarios. "
                "Devuelve únicamente la traducción."
            ),
        ).with_model("openai", "gpt-4.1-mini")
        resp = await chat.send_message(UserMessage(text=f"Traduce este texto al español:\n\n{source_en}"))
        summary_es = (resp or "").strip()
    except Exception as e:
        logger.error(f"Translation failed for {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Translation service error: {e}")

    if summary_es:
        await db.translations.update_one(
            {"ticker": ticker, "source_hash": source_hash},
            {"$set": {
                "ticker": ticker,
                "source_hash": source_hash,
                "summary_es": summary_es,
                "translated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )

    return {"ticker": ticker, "summary_es": summary_es, "source_hash": source_hash, "cached": False}


@api_router.get("/compare")
async def compare(tickers: str = Query(..., description="Comma-separated tickers")):
    syms = [s.strip().upper() for s in tickers.split(",") if s.strip()]
    if not syms or len(syms) > 100:
        raise HTTPException(status_code=400, detail="Provide 1 to 100 tickers")
    results = []
    for s in syms:
        try:
            cached = await db.fundamentals.find_one({"ticker": s}, {"_id": 0})
            if cached:
                try:
                    as_of = datetime.fromisoformat(cached["data"]["as_of"])
                    if datetime.now(timezone.utc) - as_of < timedelta(hours=CACHE_TTL_HOURS):
                        results.append(cached["data"])
                        continue
                except Exception:
                    pass
            payload = await run_in_threadpool(fetch_fundamentals_sync, s)
            ratios = compute_custom_ratios({
                "revenue_2y": payload["auto_projections"]["revenue_2y"],
                "fcf_2y": payload["auto_projections"]["fcf_2y"],
                "shares_outstanding": payload["shares_outstanding"],
                "gross_margin": payload["gross_margin"],
                "operating_margin": payload["operating_margin"],
                "net_debt": payload["net_debt"],
                "market_cap": payload["market_cap"],
                "revenue_cagr_4y": payload["auto_projections"]["revenue_cagr_4y"],
                "fcf_cagr_4y": payload["auto_projections"]["fcf_cagr_4y"],
                "current_price": payload["current_price"],
            })
            payload["custom_ratios"] = ratios
            await db.fundamentals.update_one(
                {"ticker": s},
                {"$set": {"ticker": s, "data": payload, "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            results.append(payload)
        except Exception as e:
            logger.warning(f"compare failed {s}: {e}")
            results.append({"ticker": s, "error": str(e)})
    return {"results": results}


@api_router.get("/search")
async def search(q: str = Query(..., min_length=1)):
    """Search for tickers using yfinance."""
    def _do_search():
        try:
            s = yf.Search(q, max_results=8)
            quotes = s.quotes or []
            return [{
                "symbol": x.get("symbol"),
                "name": x.get("shortname") or x.get("longname"),
                "exchange": x.get("exchange"),
                "type": x.get("quoteType"),
            } for x in quotes if x.get("symbol")]
        except Exception as e:
            logger.warning(f"search failed: {e}")
            return []
    results = await run_in_threadpool(_do_search)
    return {"results": results}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# Nightly screener (runs at 06:00 UTC every day) — guarded so the scheduler
# only starts when running under uvicorn (not during test imports).
_scheduler: Optional[AsyncIOScheduler] = None


async def _scheduled_screener_run():
    async def _fetch(ticker: str, force_refresh: bool = False):
        try:
            payload = await run_in_threadpool(fetch_fundamentals_sync, ticker)
            await db.fundamentals.update_one(
                {"ticker": ticker.upper()},
                {"$set": {"ticker": ticker.upper(), "data": payload, "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            return payload
        except Exception as e:
            logger.warning(f"scheduled screener fetch {ticker} failed: {e}")
            cached = await db.fundamentals.find_one({"ticker": ticker.upper()}, {"_id": 0})
            return cached.get("data") if cached else None
    try:
        await run_screener(db, _fetch, compute_custom_ratios)
    except Exception as e:
        logger.error(f"scheduled screener crashed: {e}")


@app.on_event("startup")
async def _startup_scheduler():
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.add_job(_scheduled_screener_run, CronTrigger(hour=6, minute=0))
        _scheduler.start()
        logger.info("Screener scheduler started (06:00 UTC daily).")


@app.on_event("shutdown")
async def shutdown_db_client():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
    client.close()

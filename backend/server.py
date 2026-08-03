from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
import asyncio
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
from radar import run_radar
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
_thesis_router = make_thesis_router(db, _auth_required, _auth_optional)
api_router.include_router(_thesis_router)

from routes.help import make_router as make_help_router
api_router.include_router(make_help_router())

from routes.macro import make_router as make_macro_router
api_router.include_router(make_macro_router(db))

from routes.exports import make_router as make_exports_router
api_router.include_router(make_exports_router(db, _auth_required))

from routes.share import make_router as make_share_router
api_router.include_router(make_share_router(db, _auth_required, _auth_optional))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CACHE_TTL_HOURS = 6



# ---------------------- Valuation logic (extracted to services/valuation.py) ----------------------
from services.valuation import (
    fetch_fundamentals_sync,
    compute_custom_ratios,
    _safe_float,
    _cagr,
    _series_to_pairs,
    _get_row,
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

def _payload_is_degraded(p: dict) -> bool:
    """Detects a transient/incomplete Yahoo response so we never serve a poisoned cache.
    A real company always has a market cap; a healthy fetch also has balance-sheet
    net_debt AND TTM revenue. POC/POV additionally requires shares + market_cap, which
    Yahoo occasionally drops when returning a partial `info` (e.g. AMD)."""
    if not p:
        return True
    ap = p.get("auto_projections", {}) or {}
    ttm_rev = (ap.get("revenue_growth_breakdown") or {}).get("total_revenue_ttm")
    classic_degraded = p.get("market_cap") is not None and p.get("net_debt") is None and ttm_rev is None
    core_missing = p.get("shares_outstanding") is None or p.get("market_cap") is None
    return classic_degraded or core_missing


@api_router.get("/")
async def root():
    return {"message": "Valuation Studio API", "version": "1.0"}


@api_router.get("/company/{ticker}")
async def get_company(ticker: str, refresh: bool = False):
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker required")

    def _is_degraded(p: dict) -> bool:
        return _payload_is_degraded(p)

    # Cache lookup
    cached = await db.fundamentals.find_one({"ticker": ticker}, {"_id": 0})
    if cached and not refresh:
        try:
            as_of = datetime.fromisoformat(cached["data"]["as_of"])
            # Schema guard: force a refresh for docs cached before the revenue TTM/ANUAL
            # horizon fields existed, so old caches auto-upgrade instead of hiding the toggle.
            schema_ok = ("ttm_target_quarter" in cached["data"].get("auto_projections", {})
                         and "last_earnings_date" in cached["data"])
            # Never serve a stale degraded (transient bad fetch) payload: refetch to heal it.
            # A recently-fetched degraded doc is served as-is (genuine data gap, e.g. an ETF)
            # so we don't hammer Yahoo on every load.
            degraded = _is_degraded(cached["data"])
            recently_fetched = datetime.now(timezone.utc) - as_of < timedelta(hours=1)
            if schema_ok and (not degraded or recently_fetched) and datetime.now(timezone.utc) - as_of < timedelta(hours=CACHE_TTL_HOURS):
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
        # Retry once if the response came back degraded (transient Yahoo hiccup) so we
        # don't cache/serve a payload with missing net_debt / TTM data.
        if _is_degraded(payload):
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


@api_router.post("/admin/run-radar")
async def admin_run_radar():
    """Manual trigger for the weekly trend radar — useful for QA."""
    return {"ok": True, **(await run_radar(db))}


@api_router.post("/admin/run-alerts")
async def admin_run_alerts():
    """Manual trigger for the daily per-company watch alerts — useful for QA."""
    return {"ok": True, **(await _thesis_router.run_company_alerts())}


@api_router.post("/admin/preview-radar/{user_id}")
async def admin_preview_radar_start(user_id: str, send: bool = False):
    """Kick off a radar email PREVIEW job for one user. Returns a job_id; poll
    /admin/preview-radar/job/{job_id} for the rendered HTML when `status: done`.
    Async because the news-watch step hits DDG + LLM (~60-120s).

    If `send=true` is passed, the rendered email is ALSO delivered via Resend to
    the user's address (real inbox preview, not just screenshot)."""
    import uuid
    from radar import build_preview_for_user, _send_email_resend
    job_id = f"radarprev_{uuid.uuid4().hex[:12]}"
    await db.thesis_jobs.insert_one({
        "id": job_id, "kind": "radar_preview", "user_id": user_id,
        "status": "pending", "send_requested": bool(send),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    async def _run():
        try:
            preview = await build_preview_for_user(db, user_id, trends=None)
            sent = False
            if send and preview.get("email"):
                n_news = preview.get("news_items_count", 0)
                n_co = preview.get("companies_count", 0)
                bits = []
                if n_news:
                    bits.append(f"{n_news} noticia{'s' if n_news != 1 else ''} de tus empresas")
                if n_co and not n_news:
                    bits.append(f"{n_co} empresa{'s' if n_co != 1 else ''} en seguimiento")
                subject = "[PREVIEW] Radar · " + (" · ".join(bits) if bits else "test")
                sent = await _send_email_resend(preview["email"], subject, preview["html"])
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "done", "result": preview, "sent": sent,
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"radar preview job failed ({job_id}): {e}")
            await db.thesis_jobs.update_one(
                {"id": job_id},
                {"$set": {"status": "error", "error": str(e)}},
            )

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "pending", "will_send": bool(send)}


@api_router.get("/admin/preview-radar/job/{job_id}")
async def admin_preview_radar_status(job_id: str, html: bool = False):
    """Poll status of a radar preview job. If `html=true` and status=done,
    returns the HTML body directly (for opening in a browser/screenshot)."""
    from fastapi.responses import HTMLResponse, JSONResponse
    job = await db.thesis_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return JSONResponse({"detail": "job not found"}, status_code=404)
    if html and job.get("status") == "done":
        return HTMLResponse(content=(job.get("result") or {}).get("html") or "")
    return job


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


# ---------------------- Quarterly TTM history ----------------------

QUARTERLY_CACHE_HOURS = 12


def _q_label(date_str: str) -> str:
    """'2026-03-31' -> '2026Q1' (calendar quarter)."""
    y = int(date_str[:4])
    m = int(date_str[5:7])
    return f"{y}Q{(m - 1) // 3 + 1}"


def _rolling_ttm(qpairs):
    """Rolling 4-quarter sums over consecutive quarterly points (ascending {date, value}).

    A TTM point is only emitted when the 4 quarters are actually consecutive
    (span between first and last ≈ 9 months), so gaps in Yahoo's quarterly data
    never produce a bogus sum.
    """
    out = []
    if len(qpairs) < 4:
        return out
    try:
        dates = [datetime.strptime(p["date"], "%Y-%m-%d") for p in qpairs]
    except Exception:
        return out
    for i in range(3, len(qpairs)):
        span = (dates[i] - dates[i - 3]).days
        if 240 <= span <= 330:  # 3 quarter-gaps ≈ 273 days, with tolerance
            out.append({
                "label": _q_label(qpairs[i]["date"]),
                "date": qpairs[i]["date"],
                "value": sum(qpairs[j]["value"] for j in range(i - 3, i + 1)),
                "kind": "real",
            })
    return out


def _approx_quarterly_from_annual(annual_pairs):
    """Approximate quarterly TTM points by interpolating between fiscal-year-end
    anchors (each annual statement value IS the TTM at that date). Geometric
    interpolation when both endpoints are positive, linear otherwise."""
    pts = []
    parsed = []
    for p in annual_pairs:
        if p.get("value") is None:
            continue
        try:
            parsed.append((datetime.strptime(str(p["date"])[:10], "%Y-%m-%d"), p["value"]))
        except Exception:
            continue
    if len(parsed) < 2:
        return pts

    def _interp(a, b, frac):
        if a > 0 and b > 0:
            return a * (b / a) ** frac
        return a + (b - a) * frac

    for (da, va), (db_, vb) in zip(parsed, parsed[1:]):
        ds_a = da.strftime("%Y-%m-%d")
        pts.append({"label": _q_label(ds_a), "date": ds_a, "value": va, "kind": "approx"})
        total_days = (db_ - da).days
        if total_days <= 0:
            continue
        n_steps = max(1, round(total_days / 91.3))
        for k in range(1, n_steps):
            frac = k / n_steps
            d = (da + timedelta(days=total_days * frac)).strftime("%Y-%m-%d")
            pts.append({"label": _q_label(d), "date": d, "value": _interp(va, vb, frac), "kind": "approx"})
    dl, vl = parsed[-1]
    ds_l = dl.strftime("%Y-%m-%d")
    pts.append({"label": _q_label(ds_l), "date": ds_l, "value": vl, "kind": "approx"})
    return pts


def _merge_ttm(approx_pts, real_pts):
    """Real points win over approximations at the same quarter label."""
    by_label = {p["label"]: p for p in approx_pts}
    for p in real_pts:
        by_label[p["label"]] = p
    return sorted(by_label.values(), key=lambda x: x["date"])


def _cagr_to_point(annual_pairs, point):
    """CAGR from the earliest annual value up to a TTM point (proxy for the
    formula's CAGR input, mirroring the yearly ratio-history approach)."""
    vals = [p for p in annual_pairs if p.get("value") is not None]
    if not vals or point.get("value") is None:
        return 0.0
    try:
        d0 = datetime.strptime(str(vals[0]["date"])[:10], "%Y-%m-%d")
        dt = datetime.strptime(point["date"], "%Y-%m-%d")
    except Exception:
        return 0.0
    span = max(1, round((dt - d0).days / 365.25))
    c = _cagr([vals[0]["value"], point["value"]], span)
    return c if c is not None else 0.0


@api_router.get("/company/{ticker}/quarterly-history")
async def quarterly_history(ticker: str):
    """Quarterly TTM series for the Revenue / FCF / POC-POV charts.

    - revenue_ttm / fcf_ttm: real TTM points (rolling 4 consecutive quarters from
      Yahoo's quarterly statements, ~2-3 points) + 'approx' backfill interpolated
      from the annual history so the axis reaches as far back as annual data does.
    - ratio_ttm: POC/POV computed ONLY on real TTM quarters (quarter-end close ×
      current shares as market cap, same proxy approach as /ratio-history).
    Forward projection is built client-side from the user's own 1y/2y projections.
    Cached 12h per ticker to avoid hammering Yahoo.
    """
    ticker = ticker.upper().strip()
    cached_company = await db.fundamentals.find_one({"ticker": ticker}, {"_id": 0})
    if not cached_company:
        raise HTTPException(status_code=404, detail="Company not loaded yet — open it first.")
    data = cached_company.get("data", {})

    cached_q = await db.quarterly_history.find_one({"ticker": ticker}, {"_id": 0})
    if cached_q:
        try:
            fetched = datetime.fromisoformat(cached_q["fetched_at"])
            if datetime.now(timezone.utc) - fetched < timedelta(hours=QUARTERLY_CACHE_HOURS):
                return cached_q["payload"]
        except Exception:
            pass

    def _fetch():
        t = yf.Ticker(ticker)
        try:
            qfin = t.quarterly_financials
        except Exception:
            qfin = pd.DataFrame()
        try:
            qcf = t.quarterly_cashflow
        except Exception:
            qcf = pd.DataFrame()
        try:
            hist = t.history(period="max", interval="1mo", auto_adjust=True)
        except Exception:
            hist = pd.DataFrame()
        return qfin, qcf, hist

    qfin, qcf, hist = await run_in_threadpool(_fetch)

    q_rev = _series_to_pairs(_get_row(qfin, ["Total Revenue", "TotalRevenue", "Revenue"]), limit=8)
    fcf_q_series = _get_row(qcf, ["Free Cash Flow", "FreeCashFlow"])
    if fcf_q_series is None:
        ocf_q = _get_row(qcf, ["Operating Cash Flow", "Total Cash From Operating Activities", "CashFlowFromContinuingOperatingActivities"])
        capex_q = _get_row(qcf, ["Capital Expenditure", "Capital Expenditures", "CapitalExpenditure"])
        if ocf_q is not None and capex_q is not None:
            fcf_q_series = ocf_q + capex_q
    q_fcf = _series_to_pairs(fcf_q_series, limit=8)

    rev_ttm_real = _rolling_ttm(q_rev)
    fcf_ttm_real = _rolling_ttm(q_fcf)

    annual_rev = data.get("revenue_history") or []
    annual_fcf = data.get("fcf_history") or []
    rev_ttm = _merge_ttm(_approx_quarterly_from_annual(annual_rev), rev_ttm_real)
    fcf_ttm = _merge_ttm(_approx_quarterly_from_annual(annual_fcf), fcf_ttm_real)

    # POC/POV per TTM quarter: uses the full merged series (real + approx TTM) so the
    # axis goes as far back as annual data allows. Prices are always real quarter-end
    # closes; a point is flagged "approx" when its revenue or FCF TTM is interpolated.
    ratio_ttm = []
    shares = data.get("shares_outstanding")
    if shares and shares > 0 and rev_ttm and fcf_ttm and hist is not None and not hist.empty:
        closes_by_q: Dict[str, float] = {}
        try:
            for idx, row in hist.iterrows():
                close = _safe_float(row.get("Close"))
                if close is None:
                    continue
                ds = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
                closes_by_q[_q_label(ds)] = close  # last write wins → latest month of the quarter
        except Exception as e:
            logger.warning(f"quarterly price aggregation failed for {ticker}: {e}")

        gross_m = data.get("gross_margin") or 0.0
        op_m = data.get("operating_margin") or 0.0
        cur_net_debt = data.get("net_debt") or 0.0
        fcf_by_label = {p["label"]: p for p in fcf_ttm}
        for p in rev_ttm:
            fp = fcf_by_label.get(p["label"])
            price = closes_by_q.get(p["label"])
            if fp is None or price is None or price <= 0:
                continue
            mcap = price * shares
            ratios = compute_custom_ratios({
                "revenue_2y": p["value"],
                "fcf_2y": fp["value"],
                "shares_outstanding": shares,
                "gross_margin": gross_m,
                "operating_margin": op_m,
                "net_debt": cur_net_debt,
                "market_cap": mcap,
                "revenue_cagr_4y": _cagr_to_point(annual_rev, p),
                "fcf_cagr_4y": _cagr_to_point(annual_fcf, fp),
                "current_price": price,
            })
            ratio_ttm.append({
                "label": p["label"],
                "date": p["date"],
                "price": price,
                "poc": ratios.get("poc"),
                "pov": ratios.get("pov"),
                "ratio_compra_pct": ratios.get("ratio_compra_pct"),
                "ratio_venta_pct": ratios.get("ratio_venta_pct"),
                "kind": "real" if (p["kind"] == "real" and fp["kind"] == "real") else "approx",
            })

    payload = {"ticker": ticker, "revenue_ttm": rev_ttm, "fcf_ttm": fcf_ttm, "ratio_ttm": ratio_ttm}
    await db.quarterly_history.update_one(
        {"ticker": ticker},
        {"$set": {"ticker": ticker, "fetched_at": datetime.now(timezone.utc).isoformat(), "payload": payload}},
        upsert=True,
    )
    return payload


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

    # 1) Serve fresh cache; collect the tickers that need a live fetch.
    cache_hits: Dict[str, Any] = {}
    to_fetch: List[str] = []
    for s in syms:
        cached = await db.fundamentals.find_one({"ticker": s}, {"_id": 0})
        served = False
        if cached:
            try:
                as_of = datetime.fromisoformat(cached["data"]["as_of"])
                if datetime.now(timezone.utc) - as_of < timedelta(hours=CACHE_TTL_HOURS):
                    cache_hits[s] = cached["data"]
                    served = True
            except Exception:
                pass
        if not served:
            to_fetch.append(s)

    # 2) Fetch the misses CONCURRENTLY so a cold comparison of several tickers
    #    doesn't add up serially and trip the gateway timeout (was causing 502s).
    async def _fetch_one(s: str):
        try:
            payload = await run_in_threadpool(fetch_fundamentals_sync, s)
            payload["custom_ratios"] = compute_custom_ratios({
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
            await db.fundamentals.update_one(
                {"ticker": s},
                {"$set": {"ticker": s, "data": payload, "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            return s, payload
        except Exception as e:
            logger.warning(f"compare failed {s}: {e}")
            return s, {"ticker": s, "error": str(e)}

    fetched = dict(await asyncio.gather(*[_fetch_one(s) for s in to_fetch])) if to_fetch else {}

    # 3) Assemble in the original request order.
    results = [cache_hits.get(s) or fetched.get(s) or {"ticker": s, "error": "no data"} for s in syms]
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


async def _scheduled_radar_run():
    """Hourly tick: dispatch to users whose schedule matches the current UTC
    weekday/hour. Discovery is reused from cache if fresh (≤6 days)."""
    try:
        now = datetime.now(timezone.utc)
        cursor = db.users.find(
            {"radar.enabled": True, "radar.weekday": now.weekday(), "radar.hour_utc": now.hour},
            {"_id": 0, "user_id": 1},
        )
        matching = [u["user_id"] async for u in cursor if u.get("user_id")]
        if not matching:
            return  # no one scheduled this hour → cheap no-op
        await run_radar(db, target_user_ids=matching)
    except Exception as e:
        logger.error(f"scheduled radar crashed: {e}")


async def _scheduled_alerts_run():
    """Daily per-company watch alerts (Visual bell), 06:05 UTC."""
    try:
        await _thesis_router.run_company_alerts()
    except Exception as e:
        logger.error(f"scheduled company-alerts crashed: {e}")


async def _scheduled_visual_snapshots_run():
    """Daily snapshot of each user's Visual coordinates (06:10 UTC) → time dial history."""
    try:
        await _thesis_router.run_visual_snapshots()
    except Exception as e:
        logger.error(f"scheduled visual-snapshots crashed: {e}")


async def _scheduled_ir_news_run():
    """Daily IR (Investor Relations) news ingestion from user-configured URLs, 06:15 UTC."""
    try:
        await _thesis_router.run_ir_news()
    except Exception as e:
        logger.error(f"scheduled ir-news crashed: {e}")


async def _ensure_indexes():
    """Create indexes for the hot query paths. Non-unique (safe: never fails on
    existing duplicate data) and idempotent (create_index is a no-op if present).
    Biggest win: user_sessions.session_token is looked up on every request."""
    index_map = {
        "user_sessions": [[("session_token", 1)], [("expires_at", 1)]],
        "users": [[("user_id", 1)], [("email", 1)]],
        "theses": [[("user_id", 1), ("id", 1)], [("user_id", 1), ("type", 1)],
                   [("user_id", 1), ("folder_id", 1)], [("id", 1)],
                   [("user_id", 1), ("type", 1), ("companies.ticker", 1)]],
        "thesis_folders": [[("user_id", 1), ("id", 1)]],
        "thesis_jobs": [[("id", 1)], [("user_id", 1), ("kind", 1), ("status", 1), ("created_at", 1)]],
        "fundamentals": [[("ticker", 1)]],
        "user_watchlists": [[("user_id", 1)]],
        "user_portfolios": [[("user_id", 1)]],
        "qual_snapshots": [[("user_id", 1), ("ticker", 1)]],
        "kpi_files": [[("id", 1)], [("company_id", 1), ("is_deleted", 1)], [("user_id", 1)]],
        "kpi_news": [[("id", 1)]],
        "kpi_chats": [[("session_id", 1)]],
        "company_alerts": [[("user_id", 1), ("ticker", 1)]],
        "translations": [[("ticker", 1), ("source_hash", 1)]],
        "radar_state": [[("id", 1)]],
        "app_settings": [[("id", 1)]],
    }
    created = 0
    for coll, keys_list in index_map.items():
        for keys in keys_list:
            try:
                await db[coll].create_index(keys)
                created += 1
            except Exception as e:
                logger.warning(f"index {coll}{keys} failed: {e}")
    logger.info(f"MongoDB indexes ensured ({created} indexes across {len(index_map)} collections).")



@app.on_event("startup")
async def _startup_scheduler():
    global _scheduler
    await _ensure_indexes()
    # Orphaned generation jobs (killed by a previous restart) would otherwise block the
    # user's serial queue forever — clear them on startup.
    try:
        await db.thesis_jobs.update_many(
            {"kind": "generate", "status": {"$in": ["processing", "queued"]}},
            {"$set": {"status": "error", "error": "Interrumpido por reinicio del servidor."}},
        )
    except Exception as e:
        logger.warning(f"orphan generate-job cleanup failed: {e}")
    try:
        from storage import init_storage
        init_storage()
        logger.info("Object storage initialized.")
    except Exception as e:
        logger.warning(f"Object storage init failed (uploads may not work): {e}")
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.add_job(_scheduled_screener_run, CronTrigger(hour=6, minute=0))
        _scheduler.add_job(_scheduled_alerts_run, CronTrigger(hour=6, minute=5))
        _scheduler.add_job(_scheduled_visual_snapshots_run, CronTrigger(hour=6, minute=10))
        _scheduler.add_job(_scheduled_ir_news_run, CronTrigger(hour=6, minute=15))
        # Hourly tick: dispatches the radar to users whose configured (weekday, hour_utc)
        # match the current UTC moment. Discovery is cached and reused inside run_radar.
        _scheduler.add_job(_scheduled_radar_run, CronTrigger(minute=0))
        _scheduler.start()
        logger.info("Schedulers started (screener 06:00 UTC daily, alerts 06:05 UTC daily, radar hourly per-user schedule).")


@app.on_event("shutdown")
async def shutdown_db_client():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
    client.close()

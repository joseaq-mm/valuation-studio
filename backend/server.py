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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Valuation Studio API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CACHE_TTL_HOURS = 6


# ---------------------- Helpers ----------------------

def _safe_float(v) -> Optional[float]:
    try:
        if v is None:
            return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _get_row(df: pd.DataFrame, candidates) -> Optional[pd.Series]:
    if df is None or df.empty:
        return None
    for name in candidates:
        if name in df.index:
            return df.loc[name]
    # case-insensitive partial
    lower = {str(i).lower(): i for i in df.index}
    for name in candidates:
        for k, original in lower.items():
            if name.lower() in k:
                return df.loc[original]
    return None


def _series_to_pairs(series: pd.Series, limit: int = 6):
    """Returns list of {date, value} sorted ascending by date, latest last."""
    if series is None:
        return []
    out = []
    for col, val in series.items():
        f = _safe_float(val)
        if f is None:
            continue
        try:
            date_str = col.strftime("%Y-%m-%d") if hasattr(col, 'strftime') else str(col)[:10]
        except Exception:
            date_str = str(col)[:10]
        out.append({"date": date_str, "value": f})
    out.sort(key=lambda x: x["date"])
    return out[-limit:]


def _cagr(values: List[float], years: int) -> Optional[float]:
    if not values or len(values) < 2 or years <= 0:
        return None
    start, end = values[0], values[-1]
    if start is None or end is None or start <= 0 or end <= 0:
        return None
    try:
        return (end / start) ** (1.0 / years) - 1.0
    except Exception:
        return None


def fetch_fundamentals_sync(ticker: str) -> Dict[str, Any]:
    """Synchronously fetch and normalize fundamentals from yfinance."""
    t = yf.Ticker(ticker)

    try:
        info = t.info or {}
    except Exception as e:
        logger.warning(f"info fetch failed for {ticker}: {e}")
        info = {}

    if not info or not info.get("symbol"):
        # Try fast_info
        try:
            fi = t.fast_info
            if fi and getattr(fi, "last_price", None):
                info = {"symbol": ticker, "currentPrice": fi.last_price,
                        "marketCap": getattr(fi, "market_cap", None),
                        "sharesOutstanding": getattr(fi, "shares", None),
                        "currency": getattr(fi, "currency", None)}
        except Exception:
            pass

    if not info:
        raise ValueError(f"No data found for ticker '{ticker}'")

    # Validate that we have at least one usable identifier/price field
    has_price = info.get("currentPrice") or info.get("regularMarketPrice")
    has_mcap = info.get("marketCap")
    has_symbol = info.get("symbol") or info.get("shortName") or info.get("longName")
    if not (has_price or has_mcap or has_symbol):
        raise ValueError(f"No data found for ticker '{ticker}'")

    # Price
    current_price = _safe_float(info.get("currentPrice")) or _safe_float(info.get("regularMarketPrice"))
    if current_price is None:
        try:
            hist = t.history(period="5d")
            if not hist.empty:
                current_price = _safe_float(hist["Close"].iloc[-1])
        except Exception:
            pass

    shares = _safe_float(info.get("sharesOutstanding"))
    market_cap = _safe_float(info.get("marketCap"))
    if market_cap is None and shares and current_price:
        market_cap = shares * current_price

    total_debt = _safe_float(info.get("totalDebt"))
    cash = _safe_float(info.get("totalCash")) or _safe_float(info.get("cash"))
    net_debt = None
    if total_debt is not None and cash is not None:
        net_debt = total_debt - cash
    elif total_debt is not None:
        net_debt = total_debt

    # Financial statements
    try:
        fin = t.financials
    except Exception:
        fin = pd.DataFrame()
    try:
        cf = t.cashflow
    except Exception:
        cf = pd.DataFrame()

    revenue_series = _get_row(fin, ["Total Revenue", "TotalRevenue", "Revenue"])
    gross_profit_series = _get_row(fin, ["Gross Profit", "GrossProfit"])
    operating_income_series = _get_row(fin, ["Operating Income", "OperatingIncome", "EBIT"])

    revenue_history = _series_to_pairs(revenue_series, limit=6)
    # ascending: oldest -> newest. We want it as is.

    # FCF: try direct, else OCF - |CapEx|
    fcf_series = _get_row(cf, ["Free Cash Flow", "FreeCashFlow"])
    if fcf_series is None:
        ocf = _get_row(cf, ["Operating Cash Flow", "Total Cash From Operating Activities", "CashFlowFromContinuingOperatingActivities"])
        capex = _get_row(cf, ["Capital Expenditure", "Capital Expenditures", "CapitalExpenditure"])
        if ocf is not None and capex is not None:
            # capex usually negative
            fcf_series = ocf + capex
    fcf_history = _series_to_pairs(fcf_series, limit=6)

    # Margins (most recent)
    gross_margin = _safe_float(info.get("grossMargins"))
    operating_margin = _safe_float(info.get("operatingMargins"))
    if gross_margin is None and revenue_series is not None and gross_profit_series is not None:
        try:
            r0 = _safe_float(revenue_series.iloc[0])
            g0 = _safe_float(gross_profit_series.iloc[0])
            if r0 and g0 is not None and r0 != 0:
                gross_margin = g0 / r0
        except Exception:
            pass
    if operating_margin is None and revenue_series is not None and operating_income_series is not None:
        try:
            r0 = _safe_float(revenue_series.iloc[0])
            o0 = _safe_float(operating_income_series.iloc[0])
            if r0 and o0 is not None and r0 != 0:
                operating_margin = o0 / r0
        except Exception:
            pass

    # Revenue estimates - analyst forecast for next 1y
    revenue_plus1y = None
    try:
        rev_est = t.revenue_estimate
        if rev_est is not None and not rev_est.empty:
            # index has '0y', '+1y'
            for idx in ['+1y', '+1Y']:
                if idx in rev_est.index:
                    avg = rev_est.loc[idx].get('avg')
                    revenue_plus1y = _safe_float(avg)
                    break
    except Exception as e:
        logger.info(f"revenue_estimate not available: {e}")

    # Revenue growth (annualized) — DO NOT use earningsGrowth (EPS, volatile)
    revenue_growth_yoy = _safe_float(info.get("revenueGrowth"))

    # Auto-compute projections (2y forward)
    latest_revenue = revenue_history[-1]["value"] if revenue_history else None
    latest_fcf = fcf_history[-1]["value"] if fcf_history else None

    def _clamp(x, lo, hi):
        if x is None:
            return None
        return max(lo, min(hi, x))

    # Track flags for extreme/suspicious projections so the UI can warn the user
    projection_flags = {
        "revenue_projection_capped": False,
        "revenue_analyst_suspicious": False,
        "fcf_projection_capped": False,
        "fcf_history_has_negatives": False,
        "fcf_cagr_fallback": False,
        "revenue_cagr_fallback": False,
    }

    # ----- Revenue 2y projection -----
    # Strategy: prefer analyst +1y → derive implied growth vs latest realized → extrapolate +1 more year.
    # Fallback to revenueGrowth or historical revenue CAGR.
    revenue_2y = None
    implied_rev_growth = None
    if revenue_plus1y and latest_revenue and latest_revenue > 0:
        implied_rev_growth = revenue_plus1y / latest_revenue - 1
        # Flag analyst estimate that is suspiciously off (>3x or <0.4x of latest)
        ratio = revenue_plus1y / latest_revenue
        if ratio > 3.0 or ratio < 0.4:
            projection_flags["revenue_analyst_suspicious"] = True

    raw_g = implied_rev_growth if implied_rev_growth is not None else revenue_growth_yoy
    rev_growth_fwd = _clamp(raw_g, -0.30, 0.50) if raw_g is not None else None
    if raw_g is not None and rev_growth_fwd is not None and raw_g != rev_growth_fwd:
        projection_flags["revenue_projection_capped"] = True

    if revenue_plus1y and rev_growth_fwd is not None:
        revenue_2y = revenue_plus1y * (1 + rev_growth_fwd)
    elif latest_revenue and rev_growth_fwd is not None:
        revenue_2y = latest_revenue * (1 + rev_growth_fwd) ** 2
    else:
        # Last resort: historical CAGR from revenue_history
        try:
            vals = [p["value"] for p in revenue_history if p["value"] and p["value"] > 0]
            if len(vals) >= 2:
                hist_cagr = (vals[-1] / vals[0]) ** (1 / (len(vals) - 1)) - 1
                hist_cagr_capped = _clamp(hist_cagr, -0.30, 0.50)
                if hist_cagr != hist_cagr_capped:
                    projection_flags["revenue_projection_capped"] = True
                if latest_revenue:
                    revenue_2y = latest_revenue * (1 + hist_cagr_capped) ** 2
        except Exception:
            pass

    # ----- FCF 2y projection -----
    # Use historical FCF CAGR (NOT earningsGrowth). Capped to avoid wild extrapolations.
    fcf_2y = None
    fcf_growth_fwd = None
    try:
        fvals = [p["value"] for p in fcf_history if p["value"] is not None]
        if any(v <= 0 for v in fvals):
            projection_flags["fcf_history_has_negatives"] = True
        pos_vals = [v for v in fvals if v > 0]
        if len(pos_vals) >= 2:
            n = len(pos_vals) - 1
            raw_fg = (pos_vals[-1] / pos_vals[0]) ** (1 / n) - 1
            fcf_growth_fwd = _clamp(raw_fg, -0.30, 0.50)
            if raw_fg != fcf_growth_fwd:
                projection_flags["fcf_projection_capped"] = True
    except Exception:
        pass

    if latest_fcf and fcf_growth_fwd is not None:
        fcf_2y = latest_fcf * (1 + fcf_growth_fwd) ** 2
    elif latest_fcf:
        # If we can't compute growth (e.g., negative FCF in history), assume flat
        fcf_2y = latest_fcf

    # ----- 1y forward values (for charting projections) -----
    revenue_1y = revenue_plus1y
    if revenue_1y is None and latest_revenue and rev_growth_fwd is not None:
        revenue_1y = latest_revenue * (1 + rev_growth_fwd)

    fcf_1y = None
    if latest_fcf and fcf_growth_fwd is not None:
        fcf_1y = latest_fcf * (1 + fcf_growth_fwd)
    elif latest_fcf:
        fcf_1y = latest_fcf

    # CAGR ingresos 4 años (2 atrás + 2 adelante)
    revenue_cagr_4y = None
    if revenue_history and len(revenue_history) >= 3 and revenue_2y:
        # Take 3rd-from-last (2y ago) as start, project end = revenue_2y, n=4 years
        try:
            start_idx = max(0, len(revenue_history) - 3)
            start_val = revenue_history[start_idx]["value"]
            if start_val and start_val > 0 and revenue_2y > 0:
                revenue_cagr_4y = (revenue_2y / start_val) ** (1.0 / 4) - 1
        except Exception:
            pass
    # Fallback: use forward growth (already capped) if 4y calc failed
    if revenue_cagr_4y is None and rev_growth_fwd is not None:
        revenue_cagr_4y = rev_growth_fwd
        projection_flags["revenue_cagr_fallback"] = True

    fcf_cagr_4y = None
    if fcf_history and len(fcf_history) >= 3 and fcf_2y:
        try:
            start_idx = max(0, len(fcf_history) - 3)
            start_val = fcf_history[start_idx]["value"]
            if start_val and start_val > 0 and fcf_2y > 0:
                fcf_cagr_4y = (fcf_2y / start_val) ** (1.0 / 4) - 1
        except Exception:
            pass
    # Fallback: if any historical FCF is non-positive, use latest_fcf -> fcf_2y over 2 years
    if fcf_cagr_4y is None and latest_fcf and fcf_2y and latest_fcf > 0 and fcf_2y > 0:
        try:
            fcf_cagr_4y = (fcf_2y / latest_fcf) ** (1.0 / 2) - 1
            projection_flags["fcf_cagr_fallback"] = True
        except Exception:
            pass
    # Last resort: use forward growth (capped)
    if fcf_cagr_4y is None and fcf_growth_fwd is not None:
        fcf_cagr_4y = fcf_growth_fwd
        projection_flags["fcf_cagr_fallback"] = True
    # Absolute last fallback: assume flat growth so the formula still computes
    if fcf_cagr_4y is None:
        fcf_cagr_4y = 0.0
        projection_flags["fcf_cagr_fallback"] = True
    if revenue_cagr_4y is None:
        revenue_cagr_4y = 0.0
        projection_flags["revenue_cagr_fallback"] = True

    # Classic ratios from info
    classic_ratios = {
        "trailing_pe": _safe_float(info.get("trailingPE")),
        "forward_pe": _safe_float(info.get("forwardPE")),
        "peg_ratio": _safe_float(info.get("pegRatio")),
        "price_to_book": _safe_float(info.get("priceToBook")),
        "price_to_sales": _safe_float(info.get("priceToSalesTrailing12Months")),
        "ev_to_ebitda": _safe_float(info.get("enterpriseToEbitda")),
        "ev_to_revenue": _safe_float(info.get("enterpriseToRevenue")),
        "roe": _safe_float(info.get("returnOnEquity")),
        "roa": _safe_float(info.get("returnOnAssets")),
        "profit_margin": _safe_float(info.get("profitMargins")),
        "debt_to_equity": _safe_float(info.get("debtToEquity")),
        "current_ratio": _safe_float(info.get("currentRatio")),
        "dividend_yield": _safe_float(info.get("dividendYield")),
        "beta": _safe_float(info.get("beta")),
        "target_mean_price": _safe_float(info.get("targetMeanPrice")),
    }

    payload = {
        "ticker": ticker.upper(),
        "name": info.get("longName") or info.get("shortName") or ticker.upper(),
        "exchange": info.get("exchange") or info.get("fullExchangeName"),
        "currency": info.get("currency") or info.get("financialCurrency") or "USD",
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "website": info.get("website"),
        "long_business_summary": (info.get("longBusinessSummary") or "")[:600],
        "current_price": current_price,
        "shares_outstanding": shares,
        "market_cap": market_cap,
        "total_debt": total_debt,
        "cash": cash,
        "net_debt": net_debt,
        "gross_margin": gross_margin,
        "operating_margin": operating_margin,
        "revenue_history": revenue_history,
        "fcf_history": fcf_history,
        "analyst_revenue_plus1y": revenue_plus1y,
        "revenue_growth_yoy": revenue_growth_yoy,
        "auto_projections": {
            "revenue_1y": revenue_1y,
            "revenue_2y": revenue_2y,
            "fcf_1y": fcf_1y,
            "fcf_2y": fcf_2y,
            "revenue_cagr_4y": revenue_cagr_4y,
            "fcf_cagr_4y": fcf_cagr_4y,
            "flags": projection_flags,
        },
        "classic_ratios": classic_ratios,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def compute_custom_ratios(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute user's custom Ratio Compra and Ratio Venta.

    POC = (revenue_2y / shares) * (1 + gross_margin) *
          ((fcf_2y - net_debt) / market_cap * 100) *
          (1 + revenue_cagr_4y) * (1 + fcf_cagr_4y)

    Ratio Compra = (POC / current_price - 1) * 100
    POV = POC * (1 + operating_margin)
    Ratio Venta = (POV / current_price - 1) * 100
    """
    fields = ["revenue_2y", "fcf_2y", "shares_outstanding", "gross_margin",
              "operating_margin", "net_debt", "market_cap",
              "revenue_cagr_4y", "fcf_cagr_4y", "current_price"]
    vals = {}
    for f in fields:
        v = _safe_float(inputs.get(f))
        vals[f] = v

    missing = [k for k, v in vals.items() if v is None]
    if missing:
        return {
            "poc": None, "pov": None, "ratio_compra_pct": None, "ratio_venta_pct": None,
            "missing_inputs": missing,
        }

    if vals["shares_outstanding"] <= 0 or vals["market_cap"] <= 0 or vals["current_price"] <= 0:
        return {"poc": None, "pov": None, "ratio_compra_pct": None, "ratio_venta_pct": None,
                "missing_inputs": ["non_positive_denominator"]}

    rev_per_share_2y = vals["revenue_2y"] / vals["shares_outstanding"]
    margin_factor = 1.0 + vals["gross_margin"]
    fcf_ratio_pct = ((vals["fcf_2y"] - vals["net_debt"]) / vals["market_cap"]) * 100.0
    rev_growth_factor = 1.0 + vals["revenue_cagr_4y"]
    fcf_growth_factor = 1.0 + vals["fcf_cagr_4y"]

    poc = rev_per_share_2y * margin_factor * fcf_ratio_pct * rev_growth_factor * fcf_growth_factor
    pov = poc * (1.0 + vals["operating_margin"])

    ratio_compra_pct = (poc / vals["current_price"] - 1.0) * 100.0
    ratio_venta_pct = (pov / vals["current_price"] - 1.0) * 100.0

    return {
        "poc": poc,
        "pov": pov,
        "ratio_compra_pct": ratio_compra_pct,
        "ratio_venta_pct": ratio_venta_pct,
        "breakdown": {
            "rev_per_share_2y": rev_per_share_2y,
            "margin_factor": margin_factor,
            "fcf_minus_netdebt_over_mcap_pct": fcf_ratio_pct,
            "rev_growth_factor": rev_growth_factor,
            "fcf_growth_factor": fcf_growth_factor,
        },
        "missing_inputs": [],
    }


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


@api_router.post("/company/{ticker}/calculate")
async def recalculate(ticker: str, inputs: CalcInputs):
    """Recompute custom ratios with user-overridden inputs."""
    return compute_custom_ratios(inputs.model_dump())


@api_router.get("/compare")
async def compare(tickers: str = Query(..., description="Comma-separated tickers")):
    syms = [s.strip().upper() for s in tickers.split(",") if s.strip()]
    if not syms or len(syms) > 6:
        raise HTTPException(status_code=400, detail="Provide 1 to 6 tickers")
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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

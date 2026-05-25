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


def _estimate_breakeven_year(history_pairs, max_horizon_years: int = 15) -> Optional[int]:
    """Estimate the fiscal year a metric (operating income or FCF) crosses 0
    using a simple linear regression on the last 4 historical points.

    - Returns the current last year if the metric is already >= 0.
    - Returns the projected year if the slope is positive and the breakeven
      lies within `max_horizon_years` from the last reported year.
    - Returns None if there is no trajectory, the trend is flat/negative, or
      the breakeven is too far away to be reliable.
    """
    if not history_pairs or len(history_pairs) < 2:
        return None
    pairs = history_pairs[-4:]
    years, vals = [], []
    for p in pairs:
        try:
            y = int(str(p.get("date", ""))[:4])
        except (TypeError, ValueError):
            continue
        v = _safe_float(p.get("value"))
        if v is None:
            continue
        years.append(y)
        vals.append(v)
    if len(years) < 2:
        return None
    last_year = years[-1]
    last_val = vals[-1]
    if last_val >= 0:
        return last_year  # already profitable
    n = len(years)
    avg_y = sum(years) / n
    avg_v = sum(vals) / n
    num = sum((years[i] - avg_y) * (vals[i] - avg_v) for i in range(n))
    den = sum((years[i] - avg_y) ** 2 for i in range(n))
    if den == 0:
        return None
    slope = num / den
    if slope <= 0:
        return None  # trajectory not converging towards profitability
    years_needed = -last_val / slope
    if years_needed > max_horizon_years:
        return None  # too far in the future to trust
    return int(last_year + math.ceil(years_needed))


def _find_annual_for_year(history, target_year: int):
    """Find the annual data point whose fiscal-year-end falls in `target_year`.
    Falls back to the closest year ≤ target if exact match not found."""
    if not history:
        return None
    exact = None
    best_below = None
    for r in history:
        try:
            y = int(str(r.get("date", ""))[:4])
        except ValueError:
            continue
        v = r.get("value")
        if v is None:
            continue
        if y == target_year:
            exact = v
        elif y < target_year and (best_below is None or y > best_below[0]):
            best_below = (y, v)
    if exact is not None:
        return exact
    return best_below[1] if best_below else None


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
    operating_income_history = _series_to_pairs(operating_income_series, limit=6)
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

    # TTM (trailing 12 months) FCF from Yahoo's pre-computed field — more current than last annual
    fcf_ttm = _safe_float(info.get("freeCashflow"))

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
    latest_fcf_annual = fcf_history[-1]["value"] if fcf_history else None
    # Use TTM as the base for FCF projections when it's positive and more recent than last annual
    if fcf_ttm is not None and fcf_ttm > 0:
        latest_fcf = fcf_ttm
    else:
        latest_fcf = latest_fcf_annual

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

    # CAGR ingresos 4 años. Window anchored on calendar year:
    # backward boundary = end of (current_year - 3)   → e.g., today=2026 → FY2023
    # forward boundary  = projected revenue at end of (current_year + 1) ≈ revenue_2y (TTM-based)
    # span n = 4 years
    current_year = datetime.now(timezone.utc).year
    backward_year_rev = current_year - 3
    revenue_cagr_4y = None
    if revenue_2y:
        start_val = _find_annual_for_year(revenue_history, backward_year_rev)
        if start_val and start_val > 0 and revenue_2y > 0:
            try:
                revenue_cagr_4y = (revenue_2y / start_val) ** (1.0 / 4) - 1
            except Exception:
                pass
    # Fallback: use forward growth (already capped) if 4y calc failed
    if revenue_cagr_4y is None and rev_growth_fwd is not None:
        revenue_cagr_4y = rev_growth_fwd
        projection_flags["revenue_cagr_fallback"] = True

    fcf_cagr_4y = None
    if fcf_2y:
        start_val = _find_annual_for_year(fcf_history, backward_year_rev)
        if start_val and start_val > 0 and fcf_2y > 0:
            try:
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

    # Growth metrics specifically helpful for small high-growth (still unprofitable) companies.
    # - revenue_growth_yoy: last year-on-year revenue growth (annualised) from Yahoo.
    # - revenue_cagr_3y_hist: pure historical CAGR over the last ~3 years of revenue.
    # - rule_of_40: revenue_growth_yoy_pct + fcf_margin_pct; classic SaaS health gauge.
    # - breakeven_year_op / breakeven_year_fcf: linear extrapolation of historical
    #   operating-income / FCF trajectory; tells the user roughly when the metric
    #   would cross zero if the recent trend holds.
    revenue_cagr_3y_hist = None
    if len(revenue_history) >= 2:
        rev_vals = [r["value"] for r in revenue_history[-4:] if r.get("value") is not None]
        span = len(rev_vals) - 1
        if span >= 1:
            revenue_cagr_3y_hist = _cagr(rev_vals, span)

    fcf_margin_ttm = None
    last_rev = revenue_history[-1]["value"] if revenue_history else None
    base_fcf = fcf_ttm if (fcf_ttm is not None) else (fcf_history[-1]["value"] if fcf_history else None)
    if last_rev and last_rev > 0 and base_fcf is not None:
        fcf_margin_ttm = base_fcf / last_rev

    rule_of_40 = None
    if revenue_growth_yoy is not None and fcf_margin_ttm is not None:
        rule_of_40 = (revenue_growth_yoy * 100.0) + (fcf_margin_ttm * 100.0)

    breakeven_year_op = _estimate_breakeven_year(operating_income_history)
    breakeven_year_fcf = _estimate_breakeven_year(fcf_history)

    growth_metrics = {
        "revenue_growth_yoy": revenue_growth_yoy,
        "revenue_cagr_3y_hist": revenue_cagr_3y_hist,
        "fcf_margin_ttm": fcf_margin_ttm,
        "rule_of_40": rule_of_40,
        "breakeven_year_op": breakeven_year_op,
        "breakeven_year_fcf": breakeven_year_fcf,
        "is_profitable_op": (operating_income_history[-1]["value"] > 0) if operating_income_history else None,
        "is_profitable_fcf": (base_fcf > 0) if base_fcf is not None else None,
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
        "operating_income_history": operating_income_history,
        "analyst_revenue_plus1y": revenue_plus1y,
        "fcf_ttm": fcf_ttm,
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
        "growth_metrics": growth_metrics,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def compute_custom_ratios(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute user's custom Ratio Compra and Ratio Venta.

    POC = (revenue_2y / shares) * (1 + gross_margin) *
          x_factor *
          (1 + revenue_cagr_4y) * (1 + fcf_cagr_4y)

    where:
      x = ((fcf_2y - net_debt) / market_cap) * 100   (raw FCF-yield-after-netdebt in %)
      x_factor =
          1 + x/100   if x < 0       (penalizes but bounded; never zeros out the formula)
          1           if 0 <= x <= 1 (financial neutrality — tiny yields don't dominate)
          x           if x > 1       (standard formula for healthy companies)

    Ratio Compra = (POC / current_price − 1) * 100
    POV = POC * y_factor
    where:
      y = operating_margin * 100  (in %)
      y_factor =
          1 + y/100   if y < 0
          1           if 0 <= y <= 1
          1 + y/100   if y > 1 (same as raw, equivalent to 1 + operating_margin)

    Ratio Venta = (POV / current_price − 1) * 100
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

    # Raw FCF-yield-after-netdebt, in % units
    x_raw = ((vals["fcf_2y"] - vals["net_debt"]) / vals["market_cap"]) * 100.0
    if x_raw < 0:
        x_factor = 1.0 + (x_raw / 100.0)
    elif x_raw <= 1.0:
        x_factor = 1.0
    elif x_raw > 10.0:
        # Upper cap: extremely high FCF yields often indicate the company can't
        # reinvest cash productively or isn't returning it to shareholders
        # (no buybacks/dividends). Cap at 10 so unusual cases don't dominate POC.
        x_factor = 10.0
    else:
        x_factor = x_raw

    rev_growth_factor = 1.0 + vals["revenue_cagr_4y"]
    fcf_growth_factor = 1.0 + vals["fcf_cagr_4y"]

    poc = rev_per_share_2y * margin_factor * x_factor * rev_growth_factor * fcf_growth_factor

    # Operating margin factor for POV: same shape as x_factor
    y_pct = vals["operating_margin"] * 100.0
    if y_pct < 0:
        y_factor = 1.0 + (y_pct / 100.0)  # == 1 + operating_margin
    elif y_pct <= 1.0:
        y_factor = 1.0
    else:
        y_factor = 1.0 + (y_pct / 100.0)  # == 1 + operating_margin

    pov = poc * y_factor

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
            "x_raw_pct": x_raw,
            "fcf_minus_netdebt_over_mcap_pct": x_factor,  # the value actually used in the formula
            "rev_growth_factor": rev_growth_factor,
            "fcf_growth_factor": fcf_growth_factor,
            "y_factor": y_factor,
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

    return await run_screener(db, _fetch, compute_custom_ratios)


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

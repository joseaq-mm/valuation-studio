"""
services/valuation.py

Pure fundamental-valuation logic extracted from server.py (no FastAPI/DB deps).
Ingests Yahoo Finance data, builds automatic projections (bottom-up FCF vs
historical CAGR) and computes the user's proprietary POC/POV custom ratios.

Kept import-compatible: server.py imports fetch_fundamentals_sync,
compute_custom_ratios and the _safe_float / _cagr helpers from here.
"""
import math
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import yfinance as yf
import pandas as pd

logger = logging.getLogger(__name__)


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
    ocf_series = _get_row(cf, ["Operating Cash Flow", "Total Cash From Operating Activities", "CashFlowFromContinuingOperatingActivities"])
    capex_series = _get_row(cf, ["Capital Expenditure", "Capital Expenditures", "CapitalExpenditure"])
    if fcf_series is None and ocf_series is not None and capex_series is not None:
        # capex usually negative
        fcf_series = ocf_series + capex_series
    fcf_history = _series_to_pairs(fcf_series, limit=6)
    ocf_history = _series_to_pairs(ocf_series, limit=6)
    # CapEx is stored as negative in cashflow statements. We'll work with the absolute value
    # for ratios/intensities to keep the math intuitive.
    capex_history = []
    if capex_series is not None:
        try:
            capex_history = _series_to_pairs(capex_series.abs(), limit=6)
        except Exception:
            capex_history = _series_to_pairs(capex_series, limit=6)

    # Net Income history (needed for the bottom-up FCF model)
    ni_series = _get_row(fin, ["Net Income", "NetIncome", "Net Income Common Stockholders", "NetIncomeCommonStockholders"])
    ni_history = _series_to_pairs(ni_series, limit=6)

    # TTM (trailing 12 months) FCF from Yahoo's pre-computed field — more current than last annual
    fcf_ttm = _safe_float(info.get("freeCashflow"))
    # EBITDA for the leverage gate (net_debt / EBITDA)
    ebitda_ttm = _safe_float(info.get("ebitda"))

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

    # Earnings estimates - analyst forecast for next-year EPS (and we'll derive NI)
    eps_plus1y = None
    try:
        earn_est = t.earnings_estimate
        if earn_est is not None and not earn_est.empty:
            for idx in ['+1y', '+1Y']:
                if idx in earn_est.index:
                    avg = earn_est.loc[idx].get('avg')
                    eps_plus1y = _safe_float(avg)
                    break
    except Exception as e:
        logger.info(f"earnings_estimate not available: {e}")

    ni_plus1y = None
    if eps_plus1y is not None and shares and shares > 0:
        ni_plus1y = eps_plus1y * shares

    # Revenue growth (annualized) — DO NOT use earningsGrowth (EPS, volatile)
    revenue_growth_yoy = _safe_float(info.get("revenueGrowth"))

    # Auto-compute projections (2y forward)
    latest_revenue = revenue_history[-1]["value"] if revenue_history else None
    latest_fcf_annual = fcf_history[-1]["value"] if fcf_history else None
    # Pick the base for FCF projections. Yahoo's `info.freeCashflow` (TTM) is sometimes
    # stale or based on partial-quarter aggregation — for some tickers (e.g. ABNB) it is
    # noticeably BELOW the most recent annual FCF, which would produce an artificial
    # downward projection. Guard against that: prefer the higher of (TTM, latest annual)
    # when both are positive AND TTM is materially lower than the latest annual, the
    # annual is almost certainly the more reliable signal.
    if fcf_ttm is not None and fcf_ttm > 0:
        if latest_fcf_annual is not None and latest_fcf_annual > 0 and fcf_ttm < latest_fcf_annual * 0.85:
            # TTM lags the most recent annual by >15% → likely Yahoo data issue, use annual
            latest_fcf = latest_fcf_annual
            fcf_base_source = "annual_latest_yahoo_ttm_stale"
        else:
            latest_fcf = fcf_ttm
            fcf_base_source = "ttm_yahoo"
    else:
        latest_fcf = latest_fcf_annual
        fcf_base_source = "annual_latest"

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
        "fcf_bottom_up_ni_suspicious": False,
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
    # Two methods, in order of preference:
    #
    # 1) Bottom-up (preferred when analyst NI is available + clean history):
    #       OCF_+1y   = NI_+1y × mean(OCF_t / NI_t)            ← uses analyst signal
    #       CapEx_+1y = mean(CapEx/Revenue) × Revenue_+1y      ← base intensity
    #                   × trend_factor                          ← recent CapEx behaviour
    #                   × earnings_modifier                     ← reinvestment momentum
    #                   × leverage_modifier                     ← balance-sheet constraints
    #       FCF_+1y   = OCF_+1y − CapEx_+1y
    #       FCF_+2y   = FCF_+1y × (1 + g_capped)
    # 2) Historical FCF CAGR (current method, used as fallback when bottom-up isn't safe).
    fcf_2y = None
    fcf_1y_bu = None
    fcf_growth_fwd = None
    bottom_up_breakdown = None
    projection_method = "historical-cagr"

    # ---- Method 1: bottom-up ----
    try:
        ni_pos = [p["value"] for p in ni_history if p["value"] is not None and p["value"] > 0]
        # Pair them up by index from the most recent backwards. We need at least 3 paired
        # positive years to derive a stable OCF/NI ratio (avoids divide-by-near-zero noise).
        paired_ratios = []
        for ni_p, ocf_p in zip(reversed(ni_history), reversed(ocf_history)):
            ni_v = ni_p.get("value")
            ocf_v = ocf_p.get("value")
            if ni_v and ocf_v and ni_v > 0 and ocf_v > 0:
                paired_ratios.append(ocf_v / ni_v)
            if len(paired_ratios) >= 4:
                break

        rev_pairs = [p["value"] for p in revenue_history if p["value"] and p["value"] > 0]

        intensities = []
        for cx_p, rv_p in zip(reversed(capex_history), reversed(revenue_history)):
            cx_v, rv_v = cx_p.get("value"), rv_p.get("value")
            if cx_v and rv_v and rv_v > 0:
                intensities.append(cx_v / rv_v)
            if len(intensities) >= 4:
                break

        bottom_up_eligible = (
            ni_plus1y is not None and ni_plus1y > 0
            and revenue_2y is not None and revenue_plus1y is not None and revenue_plus1y > 0
            and len(paired_ratios) >= 3
            and len(intensities) >= 3
            and ni_pos                # need ≥1 positive historical NI for momentum
        )

        # Sanity-guard analyst NI estimate: yfinance occasionally returns malformed
        # earnings_estimate values (wrong fiscal year, share-count mismatch). Reject
        # estimates that imply >150% YoY growth or <-50% — those are almost always data
        # issues, not real expectations.
        if bottom_up_eligible and ni_pos:
            latest_ni_for_check = ni_pos[-1]
            if latest_ni_for_check > 0:
                ni_growth_check = ni_plus1y / latest_ni_for_check - 1
                if ni_growth_check > 1.5 or ni_growth_check < -0.5:
                    bottom_up_eligible = False
                    projection_flags["fcf_bottom_up_ni_suspicious"] = True

        if bottom_up_eligible:
            ocf_to_ni_ratio = sum(paired_ratios) / len(paired_ratios)
            # Sanity bounds: 0.3x (highly tax-heavy capital-light) ≤ ratio ≤ 4x (extreme D&A)
            ocf_to_ni_ratio = max(0.3, min(4.0, ocf_to_ni_ratio))

            capex_intensity = sum(intensities) / len(intensities)
            capex_intensity = max(0.01, min(0.50, capex_intensity))

            ocf_plus1y = ni_plus1y * ocf_to_ni_ratio
            capex_base = capex_intensity * revenue_plus1y

            # Recent trend on CapEx intensity (TTM vs structural). When we don't have OCF/CapEx
            # TTM cleanly, we approximate "recent" with the latest annual.
            latest_capex = capex_history[-1]["value"] if capex_history else None
            latest_rev = rev_pairs[-1] if rev_pairs else None
            if latest_capex and latest_rev and latest_rev > 0:
                recent_intensity = latest_capex / latest_rev
                trend_factor = _clamp(recent_intensity / capex_intensity, 0.7, 1.3) if capex_intensity > 0 else 1.0
            else:
                trend_factor = 1.0

            # Earnings momentum modifier
            latest_ni = next((v for v in reversed(ni_pos) if v), None)
            if latest_ni and latest_ni > 0:
                earnings_momentum = ni_plus1y / latest_ni - 1
                earnings_mod = 1.0 + max(-0.05, min(0.10, earnings_momentum * 0.25))
            else:
                earnings_mod = 1.0

            # Leverage modifier
            leverage_mod = 1.0
            if net_debt is not None:
                if ebitda_ttm and ebitda_ttm > 0:
                    if net_debt / ebitda_ttm > 3:
                        leverage_mod = 0.90
                    elif net_debt < 0:
                        leverage_mod = 1.05
                elif net_debt < 0:
                    leverage_mod = 1.05

            capex_plus1y = capex_base * trend_factor * earnings_mod * leverage_mod
            fcf_1y_bu = ocf_plus1y - capex_plus1y

            # Year 2: grow FCF +1y by capped revenue growth (most defensible proxy)
            g_step = rev_growth_fwd if rev_growth_fwd is not None else 0.05
            g_step = _clamp(g_step, -0.10, 0.20)
            fcf_2y_candidate = fcf_1y_bu * (1 + g_step)

            # Final sanity: bottom-up FCF should be in a reasonable band relative to TTM/last annual
            # to avoid pathological cases (e.g., one-off charge year).
            ref_fcf = latest_fcf or fcf_ttm
            if fcf_2y_candidate is not None and ref_fcf:
                ratio = fcf_2y_candidate / ref_fcf
                if 0.3 <= ratio <= 4.0:
                    fcf_2y = fcf_2y_candidate
                    projection_method = "bottom-up"
                    bottom_up_breakdown = {
                        "ocf_to_ni_ratio": round(ocf_to_ni_ratio, 3),
                        "capex_intensity": round(capex_intensity, 4),
                        "trend_factor": round(trend_factor, 3),
                        "earnings_mod": round(earnings_mod, 3),
                        "leverage_mod": round(leverage_mod, 3),
                        "ni_plus1y": ni_plus1y,
                        "ocf_plus1y": ocf_plus1y,
                        "capex_plus1y": capex_plus1y,
                        "fcf_plus1y": fcf_1y_bu,
                        "g_step": round(g_step, 3),
                    }
    except Exception as e:
        logger.info(f"bottom-up FCF computation failed for {ticker}: {e}")

    # ---- Always compute the CAGR-based breakdown when feasible, even if bottom-up was
    # chosen — this lets the UI offer TTM/ANUAL alternative bases as additional manual
    # options on top of the primary projection method.
    cagr_breakdown = None
    fcf_cagr_growth = None  # CAGR growth rate (independent of which method "won")
    try:
        fvals = [p["value"] for p in fcf_history if p["value"] is not None]
        if any(v <= 0 for v in fvals):
            projection_flags["fcf_history_has_negatives"] = True
        pos_vals = [v for v in fvals if v > 0]
        if len(pos_vals) >= 2:
            n = len(pos_vals) - 1
            raw_fg = (pos_vals[-1] / pos_vals[0]) ** (1 / n) - 1
            fcf_cagr_growth = _clamp(raw_fg, -0.30, 0.50)
            if raw_fg != fcf_cagr_growth:
                projection_flags["fcf_projection_capped"] = True
    except Exception:
        pass

    if latest_fcf is not None and fcf_cagr_growth is not None:
        cagr_breakdown = {
            "base_value": latest_fcf,
            "base_source": fcf_base_source,
            "latest_annual": latest_fcf_annual,
            "fcf_ttm": fcf_ttm,
            "growth_pct": fcf_cagr_growth,
            "positive_years_used": len([v for v in [p["value"] for p in fcf_history if p["value"] is not None] if v > 0]),
        }

    # ---- Method 2: historical FCF CAGR (fallback if bottom-up didn't apply) ----
    if fcf_2y is None:
        fcf_growth_fwd = fcf_cagr_growth
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
    if fcf_1y_bu is not None and projection_method == "bottom-up":
        fcf_1y = fcf_1y_bu
    elif latest_fcf and fcf_growth_fwd is not None:
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
            "projection_method": projection_method,
            "bottom_up_breakdown": bottom_up_breakdown,
            "cagr_breakdown": cagr_breakdown,
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

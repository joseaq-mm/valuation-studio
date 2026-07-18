"""Monthly close-price history with a shared DB cache.

Powers the Visual page time dial: the price-driven axes (Ratio Compra / Venta)
are reconstructed backwards by projecting today's implied POC/POV onto each
month's close. Prices are ticker-scoped (user-independent) so we cache them once
in `price_history_monthly` and refresh weekly.
"""
import logging
from datetime import datetime, timezone, timedelta

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


def _fetch_monthly_bulk_sync(tickers):
    """One network call for all missing tickers → {ticker: [{d, close}]}."""
    out = {}
    if not tickers:
        return out
    try:
        df = yf.download(
            tickers, period="max", interval="1mo",
            auto_adjust=True, progress=False, group_by="ticker", threads=True,
        )
    except Exception as e:
        logger.warning(f"timeline bulk download failed: {e}")
        return out
    if df is None or df.empty:
        return out

    def _series_from(close_ser):
        pts = []
        for idx, val in close_ser.items():
            if pd.isna(val):
                continue
            try:
                d = idx.strftime("%Y-%m")
                pts.append({"d": d, "close": round(float(val), 4)})
            except Exception:
                continue
        # keep one point per month (last wins) and sort
        by_month = {p["d"]: p for p in pts}
        return [by_month[k] for k in sorted(by_month.keys())]

    multi = isinstance(df.columns, pd.MultiIndex)
    for tk in tickers:
        try:
            if multi:
                if tk not in df.columns.get_level_values(0):
                    continue
                close_ser = df[tk]["Close"]
            else:
                close_ser = df["Close"]
            s = _series_from(close_ser)
            if s:
                out[tk] = s
        except Exception as e:
            logger.warning(f"timeline parse {tk} failed: {e}")
    return out


async def get_monthly_closes_bulk(db, tickers, max_age_days=7, run_in_threadpool=None):
    """Returns {ticker: [{d:'YYYY-MM', close:float}]}. Reads the cache, fetches
    only stale/missing tickers (in one bulk yfinance call) and refreshes the cache."""
    tickers = sorted({(t or "").upper().strip() for t in tickers if t})
    if not tickers:
        return {}
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max_age_days)
    result, missing = {}, []
    cached = await db.price_history_monthly.find(
        {"ticker": {"$in": tickers}}, {"_id": 0}
    ).to_list(length=len(tickers))
    cmap = {c["ticker"]: c for c in cached}
    for tk in tickers:
        c = cmap.get(tk)
        fresh = False
        if c and c.get("fetched_at"):
            try:
                fresh = datetime.fromisoformat(c["fetched_at"]) > cutoff
            except Exception:
                fresh = False
        if c and fresh and c.get("series"):
            result[tk] = c["series"]
        else:
            missing.append(tk)

    if missing:
        if run_in_threadpool is not None:
            fetched = await run_in_threadpool(_fetch_monthly_bulk_sync, missing)
        else:
            fetched = _fetch_monthly_bulk_sync(missing)
        iso = now.isoformat()
        for tk in missing:
            series = fetched.get(tk)
            if series:
                result[tk] = series
                await db.price_history_monthly.update_one(
                    {"ticker": tk},
                    {"$set": {"ticker": tk, "series": series, "fetched_at": iso}},
                    upsert=True,
                )
            elif cmap.get(tk, {}).get("series"):
                # fetch failed → fall back to the (stale) cache rather than dropping the company
                result[tk] = cmap[tk]["series"]
    return result

"""Weekly + manual data refresh (shared logic).

The refresh is intentionally SIMPLE and LLM-FREE: it keeps the quantitative data
fresh and the TAM Scores coherent, nothing else.

A refresh:
  1. Re-fetches fundamentals (yfinance) for a set of tickers into `db.fundamentals`
     (the cache shared by the company pages AND the thesis TAM Scores → fresh data
     flows both ways automatically).
  2. Recomputes and STORES each company's TAM Score inside every saved trend thesis
     (`companies[].tam_score` / `projected_revenue_busd`). Because the score is
     frozen until the next refresh, it never jumps between page loads and stays
     consistent between a company file and the theses it belongs to.

The same `refresh_user_data` is used by the manual "Refrescar" button (instant,
scoped) and by the weekly scheduler (`run_thesis_refresh`). The only difference:
the weekly job runs 7 days after the last refresh (manual OR weekly). No news, no
email, no LLM.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

import fx as fx_service
from services.thesis import compute_tam_score, effective_stage_tam
from services.valuation import fetch_fundamentals_sync

logger = logging.getLogger(__name__)

REFRESH_INTERVAL_DAYS = 7


async def _light_refresh_fundamentals(db, tickers: List[str]) -> int:
    """Re-fetch fundamentals from yfinance for each ticker into the shared cache."""
    refreshed = 0
    for tk in tickers:
        try:
            data = await asyncio.to_thread(fetch_fundamentals_sync, tk)
            await db.fundamentals.update_one(
                {"ticker": tk},
                {"$set": {"ticker": tk, "data": data,
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            refreshed += 1
        except Exception as e:
            logger.warning(f"refresh fundamentals fetch failed ({tk}): {e}")
    return refreshed


async def _revenue_busd_map(db, tickers) -> Dict[str, float]:
    """Projected 2027 revenue (revenue_2y) → USD billions, from the cache ONLY."""
    rev: Dict[str, float] = {}
    tickers = [t for t in {(t or "").upper().strip() for t in tickers} if t]
    if not tickers:
        return rev
    cached = await db.fundamentals.find(
        {"ticker": {"$in": tickers}}, {"_id": 0, "ticker": 1, "data": 1}
    ).to_list(length=4000)
    for cd in cached:
        data = cd.get("data") or {}
        rev2y = (data.get("auto_projections") or {}).get("revenue_2y")
        if rev2y is None:
            continue
        currency = data.get("currency") or "USD"
        usd = await fx_service.convert(float(rev2y), currency, "USD")
        if usd and usd > 0:
            rev[cd.get("ticker")] = usd / 1e9
    return rev


async def recompute_and_store_tam(db, uid: str, thesis_ids: Optional[list] = None) -> int:
    """Recompute and persist each company's frozen TAM Score across the user's trend
    theses (all, or just `thesis_ids`). Pure math over the fundamentals cache — no
    yfinance, no LLM. Returns the number of theses updated."""
    q: Dict[str, Any] = {"user_id": uid, "type": "trend"}
    if thesis_ids is not None:
        q["id"] = {"$in": list(thesis_ids)}
    docs = await db.theses.find(
        q, {"_id": 0, "id": 1, "companies": 1, "value_chain": 1, "tam": 1,
            "origin_ticker": 1, "allocated_tam_busd": 1}
    ).to_list(length=2000)
    tickers = set()
    for d in docs:
        for c in (d.get("companies") or []):
            tk = (c.get("ticker") or "").upper().strip()
            if tk:
                tickers.add(tk)
    rev_map = await _revenue_busd_map(db, tickers)
    updated = 0
    for d in docs:
        vc = d.get("value_chain") or []
        gtam = (d.get("tam") or {}).get("global_busd")
        otk = (d.get("origin_ticker") or "").upper().strip()
        alloc = d.get("allocated_tam_busd")
        comps = d.get("companies") or []
        if not comps:
            continue
        for c in comps:
            tk = (c.get("ticker") or "").upper().strip()
            rev = rev_map.get(tk)
            # Origin company → inherited partition slice (mutually exclusive, conserved).
            # Other companies → the value-chain stage TAM.
            if otk and tk == otk and alloc is not None:
                stage = alloc
            else:
                stage = effective_stage_tam(c, vc, gtam)
            c["tam_score"] = compute_tam_score(c.get("overall_score"), stage, rev)
            c["projected_revenue_busd"] = round(rev, 2) if rev else None
        await db.theses.update_one({"id": d["id"], "user_id": uid}, {"$set": {"companies": comps}})
        updated += 1
    return updated


async def refresh_user_data(db, uid: str, tickers) -> Dict[str, Any]:
    """Run a full refresh for a user: re-fetch the scoped tickers' fundamentals, then
    recompute the frozen TAM Score across ALL the user's trend theses (for global
    coherence) and stamp `last_refresh_at`. Shared by the manual button and the
    weekly job."""
    n = await _light_refresh_fundamentals(db, list({(t or "").upper().strip() for t in tickers if t}))
    await recompute_and_store_tam(db, uid, None)
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": uid}, {"$set": {"thesis_refresh.last_refresh_at": now}})
    return {"tickers_refreshed": n, "last_refresh_at": now}


async def run_thesis_refresh(db) -> Dict[str, Any]:
    """Weekly scheduler: for every opted-in user whose last refresh is older than
    REFRESH_INTERVAL_DAYS, refresh all the tickers in their saved trend theses and
    recompute their TAM Scores. No news, no email, no LLM."""
    summary = {"users": 0, "users_due": 0, "tickers_refreshed": 0}
    users = [u async for u in db.users.find({"thesis_refresh.enabled": True}, {"_id": 0})]
    summary["users"] = len(users)
    now = datetime.now(timezone.utc)

    for user in users:
        uid = user.get("user_id")
        if not uid:
            continue
        last = ((user.get("thesis_refresh") or {}).get("last_refresh_at"))
        if last:
            try:
                if (now - datetime.fromisoformat(last)).total_seconds() < REFRESH_INTERVAL_DAYS * 86400:
                    continue  # refreshed (manually or weekly) less than a week ago
            except Exception:
                pass
        trend_docs = await db.theses.find(
            {"user_id": uid, "type": "trend"}, {"_id": 0, "companies": 1}
        ).to_list(length=1000)
        tickers = set()
        for d in trend_docs:
            for c in (d.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                if tk:
                    tickers.add(tk)
        res = await refresh_user_data(db, uid, tickers)
        summary["users_due"] += 1
        summary["tickers_refreshed"] += res["tickers_refreshed"]

    logger.info(f"Thesis-refresh run summary: {summary}")
    return summary

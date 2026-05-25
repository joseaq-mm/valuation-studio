"""Lightweight FX conversion service.

Source: open.er-api.com (free, no key, hourly updates, base USD).
Cached in-process for 6h to keep latency low and avoid hammering the upstream.
"""
import asyncio
import logging
import time
from typing import Dict, Optional
import httpx

logger = logging.getLogger(__name__)

UPSTREAM_URL = "https://open.er-api.com/v6/latest/USD"
CACHE_TTL_SECONDS = 6 * 3600

_cache: Dict[str, float] = {}
_cache_ts: float = 0.0
_lock = asyncio.Lock()


async def _refresh() -> None:
    global _cache, _cache_ts
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(UPSTREAM_URL)
            r.raise_for_status()
            data = r.json()
        rates = data.get("rates")
        if not isinstance(rates, dict):
            raise ValueError("No rates field in upstream response")
        _cache = {k.upper(): float(v) for k, v in rates.items() if isinstance(v, (int, float))}
        _cache_ts = time.time()
        logger.info(f"FX rates refreshed: {len(_cache)} currencies (base USD).")
    except Exception as e:
        logger.warning(f"FX refresh failed: {e}")


async def get_rates() -> Dict[str, float]:
    """Returns USD-base rates (so EUR = rate[EUR] means 1 USD = rate USD)."""
    if not _cache or (time.time() - _cache_ts) > CACHE_TTL_SECONDS:
        async with _lock:
            if not _cache or (time.time() - _cache_ts) > CACHE_TTL_SECONDS:
                await _refresh()
    return dict(_cache)


async def convert(amount: float, frm: str, to: str) -> Optional[float]:
    if amount is None:
        return None
    frm = (frm or "USD").upper()
    to = (to or "USD").upper()
    if frm == to:
        return amount
    rates = await get_rates()
    if not rates:
        return None
    # Rates are USD-base. Convert via USD.
    usd_amount = amount if frm == "USD" else amount / rates.get(frm, 0) if rates.get(frm) else None
    if usd_amount is None:
        return None
    return usd_amount if to == "USD" else usd_amount * rates.get(to, 0)

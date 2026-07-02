"""Macro dashboard data (FRED).

Fetches a handful of US macro series from the St. Louis Fed (FRED) and turns them
into a clean, labelled set of indicators for the /macro page. Everything is cached
in Mongo (`macro_cache`) for a few hours since FRED updates infrequently.

Series chosen (all free, official, public domain):
  - Buffett indicator (proxy): NCBEILQ027S (Nonfinancial corporate equities, $M)
    / GDP ($B) × 100. Wilshire 5000 is no longer on FRED (licence withdrawn 2023),
    so this corporate-equities-to-GDP ratio is the standard FRED proxy.
  - Fed funds effective rate: FEDFUNDS (%)
  - Inflation (CPI YoY): CPIAUCSL → year-over-year % change
  - Labor productivity: OPHNFB (index 2017=100) + YoY %
  - M2 money supply: M2SL ($B) → YoY %
  - Oil (WTI): DCOILWTICO ($/barrel)
"""
import logging
import os
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
CACHE_TTL_HOURS = 6


def _key() -> str:
    return os.environ["FRED_API_KEY"]


async def _observations(client: httpx.AsyncClient, series_id: str, limit: int = 16) -> list:
    """Latest `limit` observations (descending). Drops FRED's '.' missing markers."""
    r = await client.get(FRED_BASE, params={
        "series_id": series_id, "api_key": _key(), "file_type": "json",
        "sort_order": "desc", "limit": limit,
    })
    r.raise_for_status()
    obs = r.json().get("observations", [])
    out = []
    for o in obs:
        v = o.get("value")
        if v in (None, ".", ""):
            continue
        try:
            out.append({"date": o.get("date"), "value": float(v)})
        except (TypeError, ValueError):
            continue
    return out


def _yoy(obs: list, periods: int) -> tuple:
    """(latest_value, date, yoy_pct) using the observation `periods` steps back."""
    if not obs:
        return None, None, None
    latest = obs[0]
    yoy = None
    if len(obs) > periods and obs[periods]["value"]:
        yoy = round((latest["value"] - obs[periods]["value"]) / obs[periods]["value"] * 100, 2)
    return latest["value"], latest["date"], yoy


def _is_stale(date_str: str, max_days: int = 150) -> bool:
    """True if the latest observation is older than `max_days` (series not kept current)."""
    if not date_str:
        return True
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - d).days > max_days
    except (ValueError, TypeError):
        return False


async def fetch_macro_indicators() -> dict:
    """Fetch + derive all indicators concurrently. Raises on network/HTTP error."""
    async with httpx.AsyncClient(timeout=20) as client:
        import asyncio
        equities, gdp, fed, cpi, prod, m2, m3, oil = await asyncio.gather(
            _observations(client, "NCBEILQ027S", 8),
            _observations(client, "GDP", 8),
            _observations(client, "FEDFUNDS", 16),
            _observations(client, "CPIAUCSL", 16),
            _observations(client, "OPHNFB", 8),
            _observations(client, "M2SL", 16),
            _observations(client, "MABMM301USM189S", 16),
            _observations(client, "DCOILWTICO", 40),
        )

    indicators = []

    # 1) Buffett indicator (proxy): equities ($M → $B) / GDP ($B) × 100
    buffett = None
    extra_b = {}
    if equities and gdp:
        eq_busd = equities[0]["value"] / 1000.0      # millions → billions
        gdp_busd = gdp[0]["value"]
        if gdp_busd:
            buffett = round(eq_busd / gdp_busd * 100, 1)
        extra_b = {"market_cap_busd": round(eq_busd, 1), "gdp_busd": round(gdp_busd, 1)}
    indicators.append({
        "key": "buffett",
        "label": "Indicador Buffett (proxy)",
        "value": buffett,
        "unit": "%",
        "as_of": equities[0]["date"] if equities else None,
        "frequency": "Trimestral",
        "description": ("Capitalización de la renta variable corporativa no financiera de EEUU dividida entre el PIB, "
                        "en porcentaje. Mide cómo de cara está la bolsa frente al tamaño de la economía real. "
                        "Como referencia histórica: por debajo de ~75% se considera barato, entre ~90-115% razonable, "
                        "y por encima de ~120% caro/sobrevalorado."),
        "interpretation": "↑ más caro · ↓ más barato",
        "extra": extra_b,
        "source": "FRED · NCBEILQ027S ÷ GDP",
        "note": "Proxy: el índice Wilshire 5000 dejó de publicarse en FRED (2023); se usa la renta variable corporativa no financiera.",
    })

    # 2) Fed funds rate
    indicators.append({
        "key": "fed_rate",
        "label": "Tipo de interés de la FED",
        "value": fed[0]["value"] if fed else None,
        "unit": "% anual",
        "as_of": fed[0]["date"] if fed else None,
        "frequency": "Mensual",
        "description": ("Tipo de interés efectivo de los fondos federales que fija la Reserva Federal de EEUU. "
                        "Es el 'precio del dinero': cuando sube, encarece el crédito y suele enfriar la economía y la bolsa; "
                        "cuando baja, estimula."),
        "interpretation": "↑ dinero caro (restrictivo) · ↓ dinero barato (expansivo)",
        "extra": {},
        "source": "FRED · FEDFUNDS",
    })

    # 3) Inflation (CPI YoY) — 12 monthly periods back
    _, cpi_date, cpi_yoy = _yoy(cpi, 12)
    indicators.append({
        "key": "inflation",
        "label": "Inflación (IPC interanual)",
        "value": cpi_yoy,
        "unit": "% interanual",
        "as_of": cpi_date,
        "frequency": "Mensual",
        "description": ("Variación del Índice de Precios al Consumo (CPI) de EEUU respecto al mismo mes del año anterior. "
                        "El objetivo de la Fed es ~2%. Una inflación alta erosiona el poder adquisitivo y suele forzar tipos más altos."),
        "interpretation": "Objetivo Fed ≈ 2%. ↑ presiona a subir tipos",
        "extra": {"index_value": cpi[0]["value"] if cpi else None, "index_base": "1982-1984=100"},
        "source": "FRED · CPIAUCSL",
    })

    # 4) Labor productivity (index + YoY) — quarterly, 4 periods back
    prod_val, prod_date, prod_yoy = _yoy(prod, 4)
    indicators.append({
        "key": "productivity",
        "label": "Productividad (output por hora)",
        "value": prod_yoy,
        "unit": "% interanual",
        "as_of": prod_date,
        "frequency": "Trimestral",
        "description": ("Productividad laboral del sector empresarial no agrícola de EEUU (producción por hora trabajada), "
                        "mostrada como variación interanual. Más productividad permite crecer sin inflación y sostiene los márgenes "
                        "empresariales; es un viento de cola estructural para la bolsa."),
        "interpretation": "↑ economía más eficiente (positivo)",
        "extra": {"index_value": prod_val, "index_base": "2017=100"},
        "source": "FRED · OPHNFB",
    })

    # 5) M2 money supply (YoY) — 12 monthly periods back
    m2_val, m2_date, m2_yoy = _yoy(m2, 12)
    indicators.append({
        "key": "m2_growth",
        "label": "Masa monetaria M2 (crecimiento)",
        "value": m2_yoy,
        "unit": "% interanual",
        "as_of": m2_date,
        "frequency": "Mensual",
        "description": ("Variación interanual de la masa monetaria M2 de EEUU (efectivo, depósitos y equivalentes líquidos). "
                        "Cuánto crece el dinero en circulación. Un crecimiento fuerte tiende a inflar activos (bolsa, inmuebles) "
                        "y, a la larga, los precios; una contracción endurece las condiciones financieras."),
        "interpretation": "↑ más liquidez (suele inflar activos) · ↓ contracción",
        "extra": {"level_busd": round(m2_val, 1) if m2_val else None},
        "source": "FRED · M2SL",
    })

    # 5b) M3 broad money (level + YoY). FRED no longer publishes a current US M3;
    # the OECD series (MABMM301USM189S) is the best available but is not kept current.
    m3_level_busd = m3_yoy = m3_date = None
    if m3:
        m3_date = m3[0]["date"]
        m3_level_busd = round(m3[0]["value"] / 1e9, 1)  # raw USD → billions
        if len(m3) > 12 and m3[12]["value"]:
            m3_yoy = round((m3[0]["value"] - m3[12]["value"]) / m3[12]["value"] * 100, 2)
    indicators.append({
        "key": "m3",
        "label": "Masa monetaria M3",
        "value": m3_level_busd,
        "unit": "miles de M$",
        "as_of": m3_date,
        "frequency": "Mensual (OCDE)",
        "stale": _is_stale(m3_date),
        "description": ("M3 = agregado monetario AMPLIO de EEUU: incluye todo el M2 más instrumentos menos "
                        "líquidos (grandes depósitos a plazo, repos, fondos monetarios institucionales, "
                        "eurodólares…). Mide el dinero 'amplio' de la economía. IMPORTANTE: la Reserva Federal "
                        "DEJÓ de publicar M3 en 2006; esta serie la mantiene la OCDE y su última actualización "
                        "disponible es de finales de 2023, por lo que NO está al día."),
        "interpretation": "↑ más liquidez amplia (suele inflar activos) · ↓ contracción",
        "extra": {"yoy_pct": m3_yoy},
        "source": "FRED · MABMM301USM189S (OCDE)",
        "note": "Serie discontinua/desactualizada: FRED ya no dispone de un M3 de EEUU en tiempo real (se muestra el último dato publicado).",
    })

    # 6) Oil (WTI)
    oil_prev = oil[20]["value"] if len(oil) > 20 else None
    oil_chg = None
    if oil and oil_prev:
        oil_chg = round((oil[0]["value"] - oil_prev) / oil_prev * 100, 1)
    indicators.append({
        "key": "oil",
        "label": "Petróleo (WTI)",
        "value": oil[0]["value"] if oil else None,
        "unit": "USD/barril",
        "as_of": oil[0]["date"] if oil else None,
        "frequency": "Diaria",
        "description": ("Precio del crudo West Texas Intermediate (WTI), referencia de EEUU, en dólares por barril. "
                        "Es un termómetro de la energía: precios altos encarecen costes y presionan la inflación; "
                        "precios bajos alivian costes pero pueden señalar debilidad de la demanda."),
        "interpretation": "↑ presiona costes/inflación · ↓ alivio (o demanda débil)",
        "extra": {"change_30d_pct": oil_chg},
        "source": "FRED · DCOILWTICO",
    })

    return {
        "indicators": indicators,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def get_macro_indicators(db, refresh: bool = False) -> dict:
    """Cached accessor: returns the cached payload if younger than CACHE_TTL_HOURS,
    otherwise refetches from FRED and stores it."""
    now = datetime.now(timezone.utc)
    if not refresh:
        cached = await db.macro_cache.find_one({"id": "us_macro"}, {"_id": 0})
        if cached and cached.get("updated_at"):
            try:
                age_h = (now - datetime.fromisoformat(cached["updated_at"])).total_seconds() / 3600
                if age_h < CACHE_TTL_HOURS:
                    cached["cached"] = True
                    return cached
            except (ValueError, TypeError):
                pass
    data = await fetch_macro_indicators()
    await db.macro_cache.update_one({"id": "us_macro"}, {"$set": {"id": "us_macro", **data}}, upsert=True)
    data["cached"] = False
    return data

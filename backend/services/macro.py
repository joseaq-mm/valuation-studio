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
  - High yield credit spread: BAMLH0A0HYM2 (ICE BofA US High Yield Index
    Option-Adjusted Spread, % over Treasuries). Informational only — not part of
    the market coefficient yet.
"""
import logging
import math
import os
import asyncio
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
CACHE_TTL_HOURS = 6

OWID_ENERGY_URL = "https://nyc3.digitaloceanspaces.com/owid-public/data/energy/owid-energy-data.csv"
ENERGY_TTL_DAYS = 7
ENERGY_SOURCES = [
    ("Petróleo", "oil_consumption"),
    ("Gas natural", "gas_consumption"),
    ("Carbón", "coal_consumption"),
    ("Nuclear", "nuclear_consumption"),
    ("Hidroeléctrica", "hydro_consumption"),
    ("Eólica", "wind_consumption"),
    ("Solar", "solar_consumption"),
    ("Biocombustibles", "biofuel_consumption"),
    ("Otras renovables", "other_renewable_consumption"),
]


def _parse_owid_energy(data: bytes) -> dict:
    """Parse OWID energy CSV → World latest-year primary-energy mix by source (TWh + %)."""
    import csv
    import io
    reader = csv.DictReader(io.StringIO(data.decode("utf-8")))
    best = None
    for row in reader:
        if row.get("country") != "World":
            continue
        try:
            year = int(row["year"])
            vals = {}
            for _label, col in ENERGY_SOURCES:
                v = row.get(col)
                vals[col] = float(v) if v not in (None, "", "NA") else 0.0
        except (ValueError, TypeError):
            continue
        if vals["oil_consumption"] > 0 and vals["gas_consumption"] > 0 and vals["coal_consumption"] > 0:
            if best is None or year > best["year"]:
                best = {"year": year, "vals": vals}
    if not best:
        raise RuntimeError("no se encontró fila 'World' válida en OWID")
    total = sum(best["vals"].values())
    comps = [{"label": lbl, "twh": round(best["vals"][col], 1),
              "pct": round(best["vals"][col] / total * 100, 1)} for lbl, col in ENERGY_SOURCES]
    comps.sort(key=lambda c: c["twh"], reverse=True)
    oil_gas = best["vals"]["oil_consumption"] + best["vals"]["gas_consumption"]
    return {
        "year": best["year"],
        "total_twh": round(total, 1),
        "oil_gas_pct": round(oil_gas / total * 100, 1),
        "components": comps,
    }


async def fetch_owid_energy_mix() -> dict:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        r = await client.get(OWID_ENERGY_URL)
        r.raise_for_status()
        data = r.content
    return await asyncio.to_thread(_parse_owid_energy, data)


def _parse_owid_energy_history(data: bytes) -> dict:
    """Parse the OWID energy CSV → {year: oil_gas_pct} for 'World', every year available.
    Used only for the one-off 10y coefficient backfill (the live card only needs the
    latest year, handled by `_parse_owid_energy`)."""
    import csv
    import io
    reader = csv.DictReader(io.StringIO(data.decode("utf-8")))
    by_year = {}
    for row in reader:
        if row.get("country") != "World":
            continue
        try:
            year = int(row["year"])
            vals = {}
            for _label, col in ENERGY_SOURCES:
                v = row.get(col)
                vals[col] = float(v) if v not in (None, "", "NA") else 0.0
        except (ValueError, TypeError):
            continue
        if vals["oil_consumption"] > 0 and vals["gas_consumption"] > 0 and vals["coal_consumption"] > 0:
            total = sum(vals.values())
            if total:
                by_year[year] = round((vals["oil_consumption"] + vals["gas_consumption"]) / total * 100, 1)
    return by_year


async def fetch_owid_energy_history() -> dict:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        r = await client.get(OWID_ENERGY_URL)
        r.raise_for_status()
        data = r.content
    return await asyncio.to_thread(_parse_owid_energy_history, data)


async def resolve_energy_mix(db) -> dict | None:
    """World energy mix from OWID, cached ~7 days (annual data). On failure, return the
    last cached value (may be stale) or None."""
    now = datetime.now(timezone.utc)
    cached = await db.macro_energy.find_one({"id": "world"}, {"_id": 0})
    if cached and cached.get("fetched_at"):
        try:
            if (now - datetime.fromisoformat(cached["fetched_at"])).days < ENERGY_TTL_DAYS:
                return cached
        except (ValueError, TypeError):
            pass
    try:
        fresh = await fetch_owid_energy_mix()
        fresh["fetched_at"] = now.isoformat()
        await db.macro_energy.update_one({"id": "world"}, {"$set": {"id": "world", **fresh}}, upsert=True)
        return fresh
    except Exception as e:
        logger.warning(f"OWID energy mix fetch failed: {e}")
        return cached


def _key() -> str:
    return os.environ["FRED_API_KEY"]


_MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _fmt_date_es(iso: str) -> str:
    if not iso:
        return ""
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return f"{d.day:02d} {_MESES_ES[d.month - 1]} {d.year}"
    except (ValueError, TypeError):
        return iso


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


ICI_INST_TNA_COL = 14  # 0-based col: INSTITUTIONAL block → TOTAL → TNA (millions of $)


def _parse_ici_institutional(data: bytes) -> dict:
    """Parse the ICI weekly MMF .xls (OLE2) and return the latest INSTITUTIONAL total
    net assets, converted to billions of dollars, with its as-of date."""
    import xlrd
    wb = xlrd.open_workbook(file_contents=data)
    sh = wb.sheet_by_index(0)
    last = None
    for r in range(9, sh.nrows):
        d = str(sh.cell_value(r, 0)).strip()
        try:
            v = float(sh.cell_value(r, ICI_INST_TNA_COL))
        except (TypeError, ValueError):
            continue
        if d and v > 0:
            last = (d, v)
    if not last:
        raise RuntimeError("no se encontró la fila de datos institucionales en el fichero del ICI")
    date_str, tna_millions = last
    try:
        as_of = datetime.strptime(date_str[:10], "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        as_of = date_str
    return {"value_busd": round(tna_millions / 1000.0, 1), "as_of": as_of}  # millions → billions


async def fetch_ici_institutional_mmf() -> dict:
    """Download the current-year ICI weekly MMF report and extract institutional MMF assets."""
    year = datetime.now(timezone.utc).year
    urls = [f"https://www.ici.org/mm_summary_data_{year}.xls",
            f"https://www.ici.org/mm_summary_data_{year - 1}.xls"]
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ValuationStudio/1.0)"}
    data = None
    async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers=headers) as client:
        for u in urls:
            try:
                r = await client.get(u)
                if r.status_code == 200 and r.content[:4] == b"\xd0\xcf\x11\xe0":
                    data = r.content
                    break
            except Exception:
                continue
    if not data:
        raise RuntimeError("no se pudo descargar el fichero del ICI")
    return await asyncio.to_thread(_parse_ici_institutional, data)


async def resolve_ici_institutional(db) -> dict | None:
    """Fetch institutional MMF from ICI. On success, persist as the last-good value.
    On failure, FREEZE: return the last-good value flagged as frozen. If never fetched
    successfully, return None so the proxy drops the component."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        fresh = await fetch_ici_institutional_mmf()
        await db.macro_ici.update_one(
            {"id": "ici_inst"},
            {"$set": {"id": "ici_inst", **fresh, "fetched_at": now_iso}}, upsert=True)
        return {**fresh, "frozen": False}
    except Exception as e:
        logger.warning(f"ICI institutional MMF fetch failed: {e}")
        last = await db.macro_ici.find_one({"id": "ici_inst"}, {"_id": 0})
        if last and last.get("value_busd") is not None:
            return {"value_busd": last["value_busd"], "as_of": last.get("as_of"), "frozen": True}
        return None


async def fetch_macro_indicators(ici_inst: dict = None, energy: dict = None) -> dict:
    """Fetch + derive all indicators concurrently. Raises on network/HTTP error."""
    async with httpx.AsyncClient(timeout=20) as client:
        import asyncio
        equities, gdp, fed, cpi, prod, m2, ltd, cp, oil, oil_m, sp500, ndx, djia, hy_spread, debt = await asyncio.gather(
            _observations(client, "NCBEILQ027S", 44),
            _observations(client, "GDP", 44),
            _observations(client, "FEDFUNDS", 16),
            _observations(client, "CPIAUCSL", 16),
            _observations(client, "OPHNFB", 44),
            _observations(client, "M2SL", 16),
            _observations(client, "LTDACBW027SBOG", 56),
            _observations(client, "COMPOUT", 56),
            _observations(client, "DCOILWTICO", 40),
            _observations(client, "MCOILWTICO", 252),
            _observations(client, "SP500", 400),
            _observations(client, "NASDAQ100", 400),
            _observations(client, "DJIA", 400),
            _observations(client, "BAMLH0A0HYM2", 1300),
            _observations(client, "GFDEBTN", 44),
        )

    indicators = []

    def _q_yoy(obs):
        if obs and len(obs) > 4 and obs[4]["value"]:
            return round((obs[0]["value"] - obs[4]["value"]) / obs[4]["value"] * 100, 2)
        return None

    def _index_at(obs, target_iso):
        """Value of the first observation on/before `target_iso` (obs is descending)."""
        if not obs or not target_iso:
            return None
        for o in obs:
            if o["date"] <= target_iso:
                return o["value"]
        return obs[-1]["value"]  # target older than history → oldest available

    # --- Extrapolación "en vivo" de Renta variable (m70) usando índices bursátiles ---
    equities_val = round(equities[0]["value"] / 1000.0, 1) if equities else None
    equities_date = equities[0]["date"] if equities else None
    equities_live_by_index = {}
    _INDEX_META = [("SP500", sp500, "S&P 500"), ("NASDAQ100", ndx, "NASDAQ 100"), ("DJIA", djia, "Dow Jones")]
    if equities_val is not None and equities_date:
        for code, obs, label in _INDEX_META:
            if not obs:
                continue
            idx_now = obs[0]["value"]
            idx_ref = _index_at(obs, equities_date)
            if not idx_ref:
                continue
            growth = idx_now / idx_ref
            equities_live_by_index[code] = {
                "label": label,
                "value": round(equities_val * growth, 1),
                "growth_pct": round((growth - 1) * 100, 2),
                "index_now": round(idx_now, 2),
                "index_ref": round(idx_ref, 2),
                "index_date": obs[0]["date"],
            }
    equities_live = {"default": "SP500", "by_index": equities_live_by_index} if equities_live_by_index else None

    # --- Extrapolación "en vivo" del PIB (m71): YoY nominal prorrateado por días ---
    gdp_live = None
    if gdp:
        gdp_yoy = _q_yoy(gdp)
        try:
            days = (datetime.now(timezone.utc) - datetime.strptime(gdp[0]["date"][:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)).days
        except (ValueError, TypeError):
            days = None
        if gdp_yoy is not None and days is not None and days >= 0:
            gdp_vivo = gdp[0]["value"] * (1 + (gdp_yoy / 100.0) * (days / 365.0))
            gdp_live = {
                "value": round(gdp_vivo, 1),
                "yoy_pct": gdp_yoy,
                "days_elapsed": days,
                "as_of": datetime.now(timezone.utc).date().isoformat(),
            }

    # 1) Renta variable de EEUU (numerador del clásico indicador Buffett)
    indicators.append({
        "key": "equities",
        "label": "Renta variable (EEUU)",
        "value": equities_val,  # millones → miles de M$
        "unit": "miles de M$",
        "as_of": equities_date,
        "frequency": "Trimestral",
        "description": ("Valor de mercado de la renta variable corporativa no financiera de EEUU (capitalización "
                        "bursátil agregada). Es el numerador del clásico 'indicador Buffett' (renta variable ÷ PIB). "
                        "Cuanto mayor frente al PIB, más cara está la bolsa."),
        "interpretation": "↑ bolsa más valorada",
        "extra": {"yoy_pct": _q_yoy(equities)},
        "live": equities_live,
        "source": "FRED · NCBEILQ027S",
    })

    # 2) PIB de EEUU (denominador del indicador Buffett)
    indicators.append({
        "key": "gdp",
        "label": "PIB (EEUU)",
        "value": round(gdp[0]["value"], 1) if gdp else None,
        "unit": "miles de M$",
        "as_of": gdp[0]["date"] if gdp else None,
        "frequency": "Trimestral",
        "description": ("Producto Interior Bruto de EEUU (tamaño de la economía real, anualizado). Es el denominador "
                        "del 'indicador Buffett'; sirve para relativizar cómo de grande es la bolsa frente a la economía."),
        "interpretation": "↑ economía mayor",
        "extra": {"yoy_pct": _q_yoy(gdp)},
        "live": gdp_live,
        "source": "FRED · GDP",
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

    # 4) Labor productivity (index level, YoY as context) — quarterly, 4 periods back
    prod_val, prod_date, prod_yoy = _yoy(prod, 4)
    indicators.append({
        "key": "productivity",
        "label": "Productividad (output por hora)",
        "value": round(prod_val, 1) if prod_val is not None else None,
        "unit": "índice (2017=100)",
        "as_of": prod_date,
        "frequency": "Trimestral",
        "description": ("Productividad laboral del sector empresarial no agrícola de EEUU (producción por hora "
                        "trabajada), como índice (base 2017=100). Más productividad permite crecer sin inflación y "
                        "sostiene los márgenes empresariales; es un viento de cola estructural para la bolsa."),
        "interpretation": "↑ economía más eficiente (positivo)",
        "extra": {"yoy_pct": prod_yoy},
        "source": "FRED · OPHNFB",
    })

    # M2 se consulta para el M3 proxy pero ya no se muestra como ficha propia.

    # 5b) M3 (proxy) — up-to-date broad money: M2 + large time deposits +
    # institutional money market funds (ICI) + commercial paper. The Fed stopped
    # publishing M3 in 2006; this reconstructs the bulk of the non-M2 components from
    # current sources (repos/eurodollars unavailable → excluded).
    def _first(o):
        return o[0]["value"] if o else None

    def _back(o, n):
        return o[n]["value"] if len(o) > n else None

    inst_now = ici_inst.get("value_busd") if ici_inst else None
    inst_frozen = bool(ici_inst.get("frozen")) if ici_inst else False
    inst_asof = ici_inst.get("as_of") if ici_inst else None

    m2_now, ltd_now, cp_now = _first(m2), _first(ltd), _first(cp)
    parts = [v for v in (m2_now, ltd_now, inst_now, cp_now) if v is not None]
    proxy_now = round(sum(parts), 1) if parts else None
    # YoY over the components with a full year of history (M2 monthly, LTD/CP weekly).
    m2_p, ltd_p, cp_p = _back(m2, 12), _back(ltd, 52), _back(cp, 52)
    m3p_yoy = None
    if None not in (m2_now, ltd_now, cp_now, m2_p, ltd_p, cp_p):
        prev = m2_p + ltd_p + cp_p
        now_core = m2_now + ltd_now + cp_now
        if prev:
            m3p_yoy = round((now_core - prev) / prev * 100, 2)
    components = [
        {"label": "M2", "value": round(m2_now, 1) if m2_now is not None else None,
         "as_of": m2[0]["date"] if m2 else None, "series": "M2SL"},
        {"label": "Grandes depósitos a plazo", "value": round(ltd_now, 1) if ltd_now is not None else None,
         "as_of": ltd[0]["date"] if ltd else None, "series": "LTDACBW027SBOG"},
    ]
    if inst_now is not None:
        components.append({"label": "Fondos monetarios institucionales", "value": round(inst_now, 1),
                           "as_of": inst_asof, "series": "ICI", "frozen": inst_frozen})
    components.append({"label": "Papel comercial", "value": round(cp_now, 1) if cp_now is not None else None,
                       "as_of": cp[0]["date"] if cp else None, "series": "COMPOUT"})

    warning = None
    if inst_frozen:
        _f = _fmt_date_es(inst_asof)
        warning = (f"No se pudo leer el ICI en esta actualización: el componente «Fondos monetarios "
                   f"institucionales» se ha CONGELADO en su último valor válido ({_f}).")
    elif inst_now is None:
        warning = ("No se pudo obtener «Fondos monetarios institucionales» del ICI; el proxy se muestra "
                   "temporalmente SIN ese componente.")

    m3p_dates = [c["as_of"] for c in components if c["as_of"]]
    indicators.append({
        "key": "m3_proxy",
        "label": "M3 (proxy) · dinero amplio",
        "value": proxy_now,
        "unit": "miles de M$",
        "as_of": min(m3p_dates) if m3p_dates else None,
        "frequency": "Semanal/Mensual",
        "formula": "M3 (proxy) = M2 + Grandes depósitos a plazo + Fondos monetarios institucionales + Papel comercial",
        "components": components,
        "warning": warning,
        "description": ("Proxy AL DÍA del M3 (dinero amplio). La Reserva Federal dejó de publicar el M3 en 2006, "
                        "así que lo reconstruimos con fuentes actuales: M2 (dinero) + grandes depósitos a plazo + "
                        "fondos monetarios institucionales (ICI, semanal) + papel comercial (deuda privada a corto). "
                        "Refleja la liquidez amplia de la economía."),
        "interpretation": "↑ más liquidez amplia (suele inflar activos) · ↓ contracción",
        "extra": {"yoy_pct": m3p_yoy},
        "source": "FRED (M2SL + LTDACBW027SBOG + COMPOUT) + ICI (institucionales)",
        "note": "Proxy: no incluye repos ni eurodólares (no disponibles limpios); es una aproximación del M3, no la cifra oficial. El crecimiento interanual se calcula sobre M2 + depósitos a plazo + papel comercial.",
    })

    # 6) Oil (WTI) — current price is shown inside the "oil_avg" card (below), so no
    # standalone card. We still need the daily series for the current price/reference.

    # 7) Oil vs historical average — monthly WTI history for an interactive dial (1-20y).
    oil_hist = [{"date": o["date"], "value": round(o["value"], 2)} for o in reversed(oil_m)] if oil_m else []
    indicators.append({
        "key": "oil_avg",
        "label": "Petróleo vs media histórica",
        "value": oil[0]["value"] if oil else (oil_m[0]["value"] if oil_m else None),
        "unit": "USD/barril",
        "as_of": oil[0]["date"] if oil else (oil_m[0]["date"] if oil_m else None),
        "frequency": "Mensual (histórico WTI)",
        "description": ("Compara el precio actual del petróleo WTI con su media de los últimos X años (ajustable con "
                        "el dial). Por encima de la media = caro frente a su historia reciente; por debajo = barato. "
                        "Media simple de los precios mensuales del WTI (FRED, desde 1986)."),
        "interpretation": "Mueve el dial para elegir el nº de años de la media",
        "history": oil_hist,
        "dial": {"min": 1, "max": 20, "default": 4},
        "source": "FRED · MCOILWTICO",
    })

    # 8) World primary-energy mix by source (OWID) + (oil+gas)/total highlight.
    if energy and energy.get("components"):
        indicators.append({
            "key": "energy_mix",
            "label": "Mix energético mundial",
            "value": energy["oil_gas_pct"],
            "unit": "% (petróleo + gas)",
            "as_of": str(energy["year"]),
            "frequency": "Anual",
            "description": ("Reparto del consumo MUNDIAL de energía primaria por fuente (petróleo, gas natural, carbón, "
                            "nuclear, hidro, eólica, solar, biocombustibles y otras renovables). La cifra destacada es "
                            "cuánto representan PETRÓLEO + GAS NATURAL sobre el total de energía primaria."),
            "interpretation": "Cuota de petróleo + gas sobre el total de energía primaria",
            "components": energy["components"],
            "total_twh": energy["total_twh"],
            "source": "Our World in Data · Energy Institute",
        })

    # 9) High yield credit spread (informational; not part of the market coefficient).
    hy_hist = [{"date": o["date"], "value": round(o["value"], 2)} for o in reversed(hy_spread)] if hy_spread else []
    indicators.append({
        "key": "high_yield_spread",
        "label": "Spread de high yield (EEUU)",
        "value": hy_spread[0]["value"] if hy_spread else None,
        "unit": "p.p. sobre Treasuries",
        "as_of": hy_spread[0]["date"] if hy_spread else None,
        "frequency": "Diaria",
        "description": ("Diferencial (spread) que exige el mercado a los bonos corporativos estadounidenses de "
                        "alto rendimiento ('high yield' o 'bonos basura') frente a la deuda del Tesoro de EEUU, "
                        "libre de riesgo. Es un termómetro directo del apetito por el riesgo crediticio."),
        "interpretation": "↑ más estrés/aversión al riesgo (spreads se ensanchan) · ↓ más apetito por riesgo (spreads se estrechan)",
        "history": hy_hist,
        "source": "FRED · BAMLH0A0HYM2",
    })

    # 10) US federal debt vs GDP (informational; not part of the market coefficient).
    debt_trend = _build_debt_trend(debt, gdp)
    debt_points = debt_trend["points"]
    last_debt = debt_points[-1] if debt_points else None
    indicators.append({
        "key": "debt_to_gdp",
        "label": "Deuda pública vs PIB (EEUU)",
        "value": last_debt["ratio"] if last_debt else None,
        "unit": "% del PIB",
        "as_of": last_debt["date"] if last_debt else None,
        "frequency": "Trimestral",
        "description": ("Deuda pública total de EEUU (Tesoro) comparada con el PIB nominal, en los últimos 10 "
                        "años. El ratio deuda/PIB mide cuántas veces la economía anual del país cabe en su deuda "
                        "acumulada — cuanto más alto, mayor es la carga de deuda relativa al tamaño de la economía."),
        "interpretation": "↑ más carga de deuda relativa a la economía · ↓ posición fiscal más desahogada",
        "history": debt_points,
        "source": "FRED · GFDEBTN / GDP",
    })

    return {
        "indicators": indicators,
        "trend": _build_trend(equities, gdp, prod),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _build_trend(equities: list, gdp: list, prod: list) -> dict:
    """Quarterly time series (last ~10 years) for the evolution chart: renta variable
    (miles de M$), PIB (miles de M$), su resta (RV − PIB) y productividad (índice).
    Only official/quarterly values; the frontend appends the estimated last point."""
    eq_map = {o["date"]: round(o["value"] / 1000.0, 1) for o in equities}
    gdp_map = {o["date"]: round(o["value"], 1) for o in gdp}
    prod_map = {o["date"]: round(o["value"], 1) for o in prod}
    dates = sorted(set(eq_map) & set(gdp_map))
    points = []
    for d in dates:
        e, g = eq_map[d], gdp_map[d]
        points.append({
            "date": d, "equities": e, "gdp": g,
            "diff": round(e - g, 1), "productivity": prod_map.get(d),
        })
    return {"points": points[-40:]}


def _build_debt_trend(debt: list, gdp: list) -> dict:
    """Quarterly time series (last 10 years) of US federal debt (miles de M$), PIB
    (miles de M$) and the debt/GDP ratio (%). GFDEBTN is in millions of dollars;
    GDP is already in billions ('miles de M$'), so debt is converted to match."""
    debt_map = {o["date"]: round(o["value"] / 1000.0, 1) for o in debt}
    gdp_map = {o["date"]: round(o["value"], 1) for o in gdp}
    dates = sorted(set(debt_map) & set(gdp_map))
    points = []
    for d in dates:
        deuda, pib = debt_map[d], gdp_map[d]
        if pib:
            points.append({"date": d, "debt": deuda, "gdp": pib, "ratio": round(deuda / pib * 100, 1)})
    return {"points": points[-40:]}


async def get_macro_indicators(db, refresh: bool = False) -> dict:
    """Cached accessor: returns the cached payload if younger than CACHE_TTL_HOURS,
    otherwise refetches from FRED and stores it. Always attaches the daily coefficient
    history."""
    now = datetime.now(timezone.utc)
    if not refresh:
        cached = await db.macro_cache.find_one({"id": "us_macro"}, {"_id": 0})
        if cached and cached.get("updated_at"):
            try:
                age_h = (now - datetime.fromisoformat(cached["updated_at"])).total_seconds() / 3600
                if age_h < CACHE_TTL_HOURS:
                    cached["cached"] = True
                    cached["coef_history"] = await _get_coef_history(db)
                    return cached
            except (ValueError, TypeError):
                pass
    ici_inst = await resolve_ici_institutional(db)
    energy = await resolve_energy_mix(db)
    data = await fetch_macro_indicators(ici_inst=ici_inst, energy=energy)
    await db.macro_cache.update_one({"id": "us_macro"}, {"$set": {"id": "us_macro", **data}}, upsert=True)
    c_now = _compute_coef_default(data)
    if c_now is not None:
        await _backfill_coef_history_10y(db, data, ici_inst)
        await _store_coef_point(db, c_now)
    data["coef_history"] = await _get_coef_history(db)
    data["cached"] = False
    return data


def _ind(data: dict, key: str) -> dict | None:
    for i in data.get("indicators", []):
        if i.get("key") == key:
            return i
    return None


HY_NEUTRAL = 3.0    # p.p. — coefficient unaffected here (curve always passes through it)
HY_CAP = 3.5        # p.p. — steepest DECLINE happens here
HY_FLOOR = 2 * HY_NEUTRAL - HY_CAP  # 2.5 p.p. — mirror image: steepest RISE happens here
HY_MAX_EFFECT = 0.15  # asymptotic ±15% swing on the coefficient, on par with the other factors
HY_K = 5.5          # fixed curve steepness (the sharpest "sustained a week" shape)


def _hy_right_half(spread: float) -> float:
    """Sigmoid centered on HY_CAP, zeroed so it reads 0 at HY_NEUTRAL."""
    s0 = 1 / (1 + math.exp(-HY_K * (HY_NEUTRAL - HY_CAP)))
    s = 1 / (1 + math.exp(-HY_K * (spread - HY_CAP)))
    return s0 - s


def _hy_spread_effect(hy: dict | None) -> float:
    """Effect of the high-yield credit spread on the market coefficient — continuous,
    S-shaped, and symmetric around HY_NEUTRAL (3.0 p.p., where it's exactly 0).

    Moving right (spread rising), the coefficient falls, accelerating until HY_CAP
    (3.5 p.p.) — its steepest point — then keeps falling but decelerating. Moving left
    (spread falling) mirrors this exactly: the coefficient rises, accelerating until
    HY_FLOOR (2.5 p.p.), then decelerating.

    Depends only on the current spread value (no persistence/history — a fixed,
    steep S-curve).

    Returns effect in (-1, 1) — positive = reward, negative = penalty.
    """
    if not hy or hy.get("value") is None:
        return 0.0
    value = hy["value"]
    raw = _hy_right_half(value) if value >= HY_NEUTRAL else -_hy_right_half(2 * HY_NEUTRAL - value)
    s0 = 1 / (1 + math.exp(-HY_K * (HY_NEUTRAL - HY_CAP)))
    bound = max(1 - s0, 1e-9)  # natural symmetric saturation magnitude as spread → ±∞
    return max(-1.0, min(1.0, raw / bound))


def _compute_coef_default(data: dict) -> float | None:
    """Server-side coefficient with the DEFAULT choices (equities live vía S&P 500,
    media del petróleo a 4 años). Mirrors the frontend formula so the stored history
    is consistent and comparable."""
    eq, gdp = _ind(data, "equities"), _ind(data, "gdp")
    m3, fed = _ind(data, "m3_proxy"), _ind(data, "fed_rate")
    infl, prod = _ind(data, "inflation"), _ind(data, "productivity")
    oil, en = _ind(data, "oil_avg"), _ind(data, "energy_mix")
    hy = _ind(data, "high_yield_spread")
    v = lambda x: x.get("value") if x else None
    m70 = (eq.get("live") or {}).get("by_index", {}).get("SP500", {}).get("value") if eq and eq.get("live") else None
    if m70 is None:
        m70 = v(eq)
    m71 = (gdp.get("live") or {}).get("value") if gdp and gdp.get("live") else v(gdp)
    m72, m73, m74, m75 = v(m3), v(fed), v(infl), v(prod)
    m76, m78 = v(oil), v(en)
    m77 = None
    if oil and oil.get("history"):
        hist = oil["history"]
        sl = hist[-min(48, len(hist)):]
        if sl:
            m77 = sum(h["value"] for h in sl) / len(sl)
    m79 = v(hy)
    vals = [m70, m71, m72, m73, m74, m75, m76, m77, m78, m79]
    if any(x is None for x in vals) or (m70 - m72) == 0:
        return None
    t1 = m71 / (m70 - m72)
    t2 = 1 - (m73 + m74) / 100
    t3 = m75 / 100
    t4 = 1 - ((m76 - m77) * (m78 / 10000))
    hy_effect = _hy_spread_effect(hy)
    t5 = 1 + HY_MAX_EFFECT * hy_effect
    return round(t1 * t2 * t3 * t4 * t5, 4)


async def _store_coef_point(db, c: float) -> None:
    """Upsert one coefficient point per day (idempotent)."""
    today = datetime.now(timezone.utc).date().isoformat()
    await db.macro_coef_history.update_one(
        {"date": today}, {"$set": {"date": today, "c": c}}, upsert=True)


async def _get_coef_history(db, years: int = 10) -> list:
    """Full coefficient history for the last `years` years — the quarterly 10y backfill
    plus every real daily point collected since. Filtered by date (not by point count):
    with the backfill's mixed quarterly/daily granularity, a fixed count would eventually
    push the oldest (quarterly) points out as daily points keep accumulating."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=365 * years)).date().isoformat()
    return await db.macro_coef_history.find(
        {"date": {"$gte": cutoff}}, {"_id": 0}).sort("date", 1).to_list(length=10000)


def _asof(obs: list, target_iso: str, ascending: bool = False):
    """Value of the observation on/before `target_iso`. Pass ascending=True if `obs`
    is sorted oldest→newest (e.g. the `history` lists built for the frontend);
    FRED's raw `_observations()` lists are newest→oldest (ascending=False, default)."""
    if not obs or not target_iso:
        return None
    seq = list(reversed(obs)) if ascending else obs
    for o in seq:
        if o["date"] <= target_iso:
            return o["value"]
    return seq[-1]["value"]


def _trailing_avg(hist_asc: list, target_iso: str, months: int = 48):
    """Average of up to `months` most recent monthly values on/before target_iso.
    `hist_asc` must be sorted oldest→newest."""
    window = [h["value"] for h in hist_asc if h["date"] <= target_iso]
    if not window:
        return None
    window = window[-months:]
    return sum(window) / len(window)


# Peso asumido del componente "fondos monetarios institucionales" dentro del proxy de M3,
# y su tendencia. La ICI solo publica el valor EN VIVO (sin archivo histórico), así que para
# reconstruir 10 años hacia atrás asumimos que ese peso ha venido SUBIENDO ~5%/año (relativo)
# — coherente con la reforma de fondos monetarios de la SEC (2016), que desplazó activos hacia
# fondos institucionales de gobierno, y con el auge de tesorería corporativa hacia MMF
# institucionales durante el ciclo de subidas de tipos 2022-23. Se aplica hacia atrás de forma
# geométrica/compuesta: peso(año-n) = peso_actual × (1 − tasa)^n.
INST_WEIGHT_ANNUAL_GROWTH = 0.05


async def _fetch_coef_backfill_series(client: httpx.AsyncClient) -> dict:
    """Extra FRED history (only needed for the one-off 10y coefficient backfill —
    not part of the regular 6h live refresh)."""
    fed, cpi, m2, ltd, cp, hy = await asyncio.gather(
        _observations(client, "FEDFUNDS", 150),
        _observations(client, "CPIAUCSL", 165),
        _observations(client, "M2SL", 150),
        _observations(client, "LTDACBW027SBOG", 600),
        _observations(client, "COMPOUT", 600),
        _observations(client, "BAMLH0A0HYM2", 2800),
    )
    return {"fed": fed, "cpi": cpi, "m2": m2, "ltd": ltd, "cp": cp, "hy": hy}


async def _backfill_coef_history_10y(db, data: dict, ici_inst: dict | None) -> None:
    """One-off: reconstruct ~10 years of QUARTERLY coefficient points (mirroring
    `_compute_coef_default`) from the actually-official quarterly series (equities/GDP/
    productivity, already in `data['trend']`), plus monthly/weekly FRED history fetched
    here for the other terms.

    The one blocker is the ICI institutional-MMF component: it only has a live snapshot,
    no history. Per explicit product decision, instead of dropping it for the backfill we
    EXTRAPOLATE it: derive its current % weight within the M3 proxy and project that weight
    backward with `INST_WEIGHT_ANNUAL_GROWTH` (geometric decay — see comment above), then
    convert the assumed weight back into an assumed dollar figure for each historical
    quarter and add it into that quarter's M2 + large time deposits + commercial paper.
    If the ICI value itself was never available, the institutional term is simply omitted
    for the backfill (same graceful degradation as the live formula).

    Idempotent by date range rather than by mere presence of data: if the oldest stored
    point is already ~10 years old, a real backfill has already run — skip. Otherwise
    (empty, or only the old shallow ~90-day synthetic seed from before this backfill
    existed) wipe whatever is there and do the real one."""
    oldest = await db.macro_coef_history.find({}, {"_id": 0, "date": 1}).sort("date", 1).to_list(length=1)
    if oldest:
        cutoff_8y = (datetime.now(timezone.utc) - timedelta(days=365 * 8)).date().isoformat()
        if oldest[0]["date"] <= cutoff_8y:
            return  # already has a real long-range backfill
        await db.macro_coef_history.delete_many({})  # stale shallow seed — replace it
    points = (data.get("trend") or {}).get("points") or []
    if not points:
        return

    m3 = _ind(data, "m3_proxy")
    proxy_now = m3.get("value") if m3 else None
    inst_now = ici_inst.get("value_busd") if ici_inst else None
    weight_now = None
    if inst_now is not None and proxy_now:
        weight_now = inst_now / proxy_now

    oil_hist = (_ind(data, "oil_avg") or {}).get("history") or []  # ascending

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            series = await _fetch_coef_backfill_series(client)
    except Exception as e:
        logger.warning(f"Coefficient 10y backfill: FRED fetch failed, skipping: {e}")
        return

    try:
        energy_by_year = await fetch_owid_energy_history()
    except Exception as e:
        logger.warning(f"Coefficient 10y backfill: OWID history fetch failed, using latest year flat: {e}")
        energy_by_year = {}
    en = _ind(data, "energy_mix")
    m78_fallback = en.get("value") if en else None

    today = datetime.now(timezone.utc).date()
    pts = []
    for p in points:
        d = p["date"]
        m70, m71, m75 = p.get("equities"), p.get("gdp"), p.get("productivity")
        if m70 is None or m71 is None or m75 is None:
            continue

        m73 = _asof(series["fed"], d)
        cpi_now = _asof(series["cpi"], d)
        try:
            prior_iso = (datetime.strptime(d, "%Y-%m-%d") - timedelta(days=365)).date().isoformat()
        except ValueError:
            prior_iso = None
        cpi_prior = _asof(series["cpi"], prior_iso) if prior_iso else None
        m74 = round((cpi_now - cpi_prior) / cpi_prior * 100, 2) if cpi_now and cpi_prior else None

        m2_h, ltd_h, cp_h = _asof(series["m2"], d), _asof(series["ltd"], d), _asof(series["cp"], d)
        if m2_h is None or ltd_h is None or cp_h is None:
            continue
        core_h = m2_h + ltd_h + cp_h
        if weight_now is not None:
            try:
                years_back = max(0.0, (today - datetime.strptime(d, "%Y-%m-%d").date()).days / 365.25)
            except ValueError:
                years_back = 0.0
            weight_h = weight_now * (1 - INST_WEIGHT_ANNUAL_GROWTH) ** years_back
            inst_h = weight_h * core_h / (1 - weight_h) if weight_h < 1 else 0.0
            m72 = core_h + inst_h
        else:
            m72 = core_h

        m76 = _asof(oil_hist, d, ascending=True)
        m77 = _trailing_avg(oil_hist, d)
        m78 = energy_by_year.get(int(d[:4]), m78_fallback)
        m79 = _asof(series["hy"], d)

        if any(x is None for x in (m73, m74, m76, m77, m78, m79)) or (m70 - m72) == 0:
            continue

        t1 = m71 / (m70 - m72)
        t2 = 1 - (m73 + m74) / 100
        t3 = m75 / 100
        t4 = 1 - ((m76 - m77) * (m78 / 10000))
        hy_effect = _hy_spread_effect({"value": m79})
        t5 = 1 + HY_MAX_EFFECT * hy_effect
        c = round(t1 * t2 * t3 * t4 * t5, 4)
        pts.append({"date": d, "c": c})

    if pts:
        await db.macro_coef_history.insert_many(pts)

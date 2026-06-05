"""Thesis Engine — qualitative AI pipeline for Valuation Studio.

Dual-AI architecture over the Emergent LLM Key:
  • GPT-5.2  = "Investigator". The Emergent proxy does NOT expose OpenAI native
    web-search, so we feed the model LIVE web results gathered server-side
    (DuckDuckGo via the `ddgs` library) and it structures them into a value
    chain + leading public companies with canonical tickers, citing sources.
  • Claude Sonnet 4.5 = "Synthesizer/Reasoner". Produces structured qualitative
    scores and a written thesis reasoning over the investigator output.

Two entry points:
  A. Trend   → value chain → leading companies + qualitative scores.
  B. Company → trends it fits in + role in the value chain + relevance score.

Every company is mapped to its canonical TICKER so the qualitative view links
to the existing quantitative dashboard at /company/{ticker}.
"""
import os
import re
import json
import logging
import contextvars
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

# ---------------------- Model presets (cost/quality switch) ----------------------
# Three presets selectable at runtime (dev/testing tool). All flows read the ACTIVE
# preset via _inv_model() / _syn_model(), so switching is a single setting change.
MODEL_PRESETS = {
    "minimo_coste": {
        "label": "Mínimo coste",
        "investigator": ("gemini", "gemini-2.5-flash-lite"),
        "synthesizer": ("gemini", "gemini-2.5-flash-lite"),
        "desc": "Investigación y síntesis con Gemini 2.5 Flash-Lite (el modelo más barato). Para alto volumen; calidad correcta.",
    },
    "equilibrado": {
        "label": "Equilibrado",
        "investigator": ("gemini", "gemini-3-flash-preview"),
        "synthesizer": ("anthropic", "claude-haiku-4-5-20251001"),
        "desc": "Investigación con Gemini 3 Flash + síntesis/scoring con Claude Haiku 4.5. Buen equilibrio coste/calidad.",
    },
    "pro": {
        "label": "Pro",
        "investigator": ("openai", "gpt-5.2"),
        "synthesizer": ("anthropic", "claude-sonnet-4-5-20250929"),
        "desc": "Investigación con GPT-5.2 + síntesis/scoring con Claude Sonnet 4.5. Máxima calidad (config actual).",
    },
}

_ACTIVE_PRESET = os.environ.get("THESIS_MODEL_PRESET", "pro")
if _ACTIVE_PRESET not in MODEL_PRESETS:
    _ACTIVE_PRESET = "pro"


def get_model_preset() -> str:
    return _ACTIVE_PRESET


def set_model_preset(name: str) -> bool:
    global _ACTIVE_PRESET
    if name in MODEL_PRESETS:
        _ACTIVE_PRESET = name
        return True
    return False


def _inv_model():
    return MODEL_PRESETS[_ACTIVE_PRESET]["investigator"]


def _syn_model():
    return MODEL_PRESETS[_ACTIVE_PRESET]["synthesizer"]


# ---------------------- Cost estimation (EUR) ----------------------
# € per 1,000,000 tokens (input, output). ESTIMATES — edit freely; refine against
# the real Universal Key usage once measured. Tokens are estimated from text length.
PRICE_EUR_PER_MTOK = {
    ("openai", "gpt-5.2"): (5.0, 15.0),
    ("anthropic", "claude-sonnet-4-5-20250929"): (3.0, 15.0),
    ("anthropic", "claude-haiku-4-5-20251001"): (0.8, 4.0),
    ("gemini", "gemini-3-flash-preview"): (0.3, 2.5),
    ("gemini", "gemini-2.5-flash-lite"): (0.10, 0.40),
}

# Per-generation cost accumulator (ContextVar — shared across awaits within one
# asyncio.run pipeline; the sync wrapper sets a fresh dict and reads it back).
_cost_acc = contextvars.ContextVar("thesis_cost_acc", default=None)


def _est_tokens(text) -> int:
    return max(1, len(text or "") // 4)


def _price(provider, model):
    return PRICE_EUR_PER_MTOK.get((provider, model), (3.0, 12.0))


INVESTIGATOR_MODEL = ("openai", "gpt-5.2")
SYNTHESIZER_MODEL = ("anthropic", "claude-sonnet-4-5-20250929")

SCORE_DIMENSIONS = [
    "competitive_position",
    "sector_momentum",
    "management_quality",
    "financial_resilience",
]


# ---------------------- Live web search (real-time) ----------------------

def _run_searches(queries: list, max_results: int = 5, cap: int = 18) -> list:
    """Run a set of live DuckDuckGo queries, de-duplicated by URL."""
    try:
        from ddgs import DDGS
    except Exception as e:  # pragma: no cover
        logger.error(f"ddgs import failed: {e}")
        return []
    seen, out = set(), []
    try:
        with DDGS() as ddgs:
            for q in queries:
                try:
                    for r in ddgs.text(q, max_results=max_results):
                        url = r.get("href") or r.get("url") or ""
                        if not url or url in seen:
                            continue
                        seen.add(url)
                        out.append({
                            "title": (r.get("title") or "").strip(),
                            "url": url,
                            "snippet": (r.get("body") or "").strip()[:500],
                        })
                except Exception as e:
                    logger.warning(f"ddgs query failed '{q}': {e}")
    except Exception as e:
        logger.warning(f"ddgs session failed: {e}")
    return out[:cap]


def gather_sources(subject: str, kind: str, max_results: int = 5) -> list:
    """Live web search for a trend or company. Returns [{title, url, snippet}].
    Synchronous (network bound) — the caller runs it in a thread."""
    subject = (subject or "").strip()
    year = datetime.now(timezone.utc).year
    if kind == "company":
        queries = [
            f"{subject} growth drivers macro trends tailwinds {year}",
            f"{subject} business segments industry value chain",
            f"{subject} stock investment thesis outlook {year}",
            f"{subject} latest strategy product launch partnership acquisition {year}",
            f"{subject} revenue growth new customers bookings traction segment {year}",
        ]
    else:
        queries = [
            f"{subject} value chain leading public companies stocks {year}",
            f"{subject} market trend outlook forecast {year}",
            f"{subject} key players suppliers beneficiaries investing",
        ]
    return _run_searches(queries, max_results)


def gather_discovery_sources(max_results: int = 5) -> list:
    """Broad live web search to surface emerging investment megatrends."""
    now = datetime.now(timezone.utc)
    year = now.year
    queries = [
        f"emerging investment megatrends {year} analysts outlook",
        f"breakthrough technologies {year} disruption stocks thematic",
        f"tendencias emergentes de inversión {year}",
        f"hot thematic investing themes {year} new opportunities",
        f"future trends {year} research commercialization investment",
    ]
    return _run_searches(queries, max_results)


async def run_in_threadpool_safe(subject: str, kind: str) -> list:
    """Run the synchronous live web search off the event loop."""
    return await run_in_threadpool(gather_sources, subject, kind)


def _sources_block(sources: list) -> str:
    lines = []
    for i, s in enumerate(sources, 1):
        lines.append(f"[{i}] {s['title']}\n    URL: {s['url']}\n    {s['snippet']}")
    return "\n\n".join(lines) if lines else "(no live results available)"


# ---------------------- JSON extraction ----------------------

def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of an LLM response (handles ```json fences)."""
    if not text:
        return {}
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    start = t.find("{")
    if start == -1:
        return {}
    depth = 0
    for i in range(start, len(t)):
        if t[i] == "{":
            depth += 1
        elif t[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except Exception:
                    break
    return {}


async def _llm(provider, model, session_id, system, user_text) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    api_key = os.environ["EMERGENT_LLM_KEY"]
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system).with_model(provider, model)
    resp = await chat.send_message(UserMessage(text=user_text))
    acc = _cost_acc.get()
    if acc is not None:
        ti = _est_tokens(system) + _est_tokens(user_text)
        to = _est_tokens(resp)
        pin, pout = _price(provider, model)
        acc["calls"] += 1
        acc["tokens_in"] += ti
        acc["tokens_out"] += to
        acc["cost_eur"] += (ti * pin + to * pout) / 1_000_000
    return resp


def run_costed(coro):
    """Run an async generation pipeline while accumulating an estimated EUR cost
    for every _llm call it makes. Returns (result, cost_dict)."""
    acc = {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_eur": 0.0}
    tok = _cost_acc.set(acc)
    try:
        import asyncio
        result = asyncio.run(coro)
    finally:
        _cost_acc.reset(tok)
    return result, acc


def _clamp_score(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, round(v)))


def _clamp10(v):
    """Probability on a 0-10 integer scale (0 = very unlikely, 10 = near certainty)."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return max(0, min(10, round(v)))


def aggregate_folder_tam(trends):
    """Sum the global TAM of the trends inside a megatrend (folder), EXCLUDING any
    trend that is a nested CHILD (sub-thesis) so a sub-segment's market is never
    double-counted with its mother's broader market ("solo la madre").

    Each `trends` item is a dict with 'tam_busd' (number|None) and 'is_child' (bool).
    Returns a 1-decimal float (USD billions) or None when nothing is counted.
    """
    total = sum((t.get("tam_busd") or 0) for t in trends if not t.get("is_child"))
    return round(total, 1) if total else None


def compute_tam_score(overall_score, stage_tam_busd, revenue_busd):
    """TAM Score = (overall_score/100 × stage_TAM) / projected_revenue.

    All magnitudes must share units (here: USD billions for TAM and revenue).
    Returns a 2-decimal float, or None when any input is missing or revenue ≤ 0.
    Reads as a multiple: >1 = addressable market (quality-weighted) exceeds the
    company's projected size (runway); <1 = company already large vs. that stage.
    """
    if overall_score is None or stage_tam_busd is None or revenue_busd is None:
        return None
    try:
        rev = float(revenue_busd)
        if rev <= 0:
            return None
        return round((float(overall_score) / 100.0 * float(stage_tam_busd)) / rev, 2)
    except (TypeError, ValueError):
        return None


def _busd(v):
    """Coerce a TAM value to a non-negative number of USD billions (or None)."""
    if isinstance(v, str):
        v = v.replace(",", "").replace("$", "").strip()
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v < 0:
        return None
    return round(v, 1)


def _normalize_tam(tam):
    if not isinstance(tam, dict):
        return None
    return {
        "global_busd": _busd(tam.get("global_busd")),
        "year": tam.get("year") or 2027,
        "note": tam.get("note"),
    }


def _normalize_value_chain(vc):
    out = []
    for s in (vc or []):
        if not isinstance(s, dict):
            continue
        out.append({
            "stage": s.get("stage"),
            "description": s.get("description"),
            "tam_busd": _busd(s.get("tam_busd")),
        })
    return out


# ---------------------- Flow A: Trend → companies ----------------------

INVESTIGATOR_TREND_SYS = (
    "Eres un analista de equity research senior especializado en mapear cadenas de valor. "
    "Recibes resultados REALES de búsqueda web reciente. Tu trabajo es estructurar la "
    "información, NO inventar. Identifica empresas COTIZADAS con su TICKER bursátil canónico "
    "exacto tal como aparece en Yahoo Finance (ej. NVDA, ASML.AS, TSM, 005930.KS). "
    "Si una empresa no cotiza o no estás seguro del ticker, no la incluyas. "
    "Clasificas cada empresa como 'leader' (líder establecido que ya domina su eslabón) o "
    "'disruptor' (retador / líder del cambio que podría redefinir el eslabón). "
    "Estimas el TAM (mercado total direccionable) en MILES DE MILLONES DE USD proyectado a 2027 "
    "(base TTM): un TAM global de la tendencia y un TAM por cada eslabón de la cadena de valor. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)


async def run_trend_thesis(trend: str, sources: list) -> dict:
    sources_block = _sources_block(sources)
    inv_user = (
        f"TENDENCIA / TEMA A ANALIZAR: {trend}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{sources_block}\n\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "title": "título corto de la tesis",\n'
        '  "summary": "2-3 frases sobre por qué es una megatendencia relevante para invertir",\n'
        '  "tam": {"global_busd": 0, "year": 2027, "note": "1 frase: alcance y supuesto del TAM global"},\n'
        '  "value_chain": [{"stage": "nombre del eslabón", "description": "qué ocurre aquí", "tam_busd": 0}],\n'
        '  "companies": [{"name": "Nombre", "ticker": "TICKER", "value_chain_role": "nombre EXACTO del eslabón (igual que en value_chain)", "category": "leader|disruptor", "why": "1-2 frases sobre por qué es líder o disruptor de ese eslabón"}]\n'
        "}\n"
        "REGLAS:\n"
        "- 'global_busd' y 'tam_busd' son números en miles de millones de USD a 2027 (TTM).\n"
        "- Para CADA eslabón de value_chain debe haber AL MENOS 1 empresa 'leader' Y AL MENOS 1 'disruptor'.\n"
        "- 'value_chain_role' de cada empresa debe coincidir EXACTAMENTE con un 'stage' de value_chain.\n"
        "- Usa 3-5 eslabones y todas las empresas reales y cotizadas con su TICKER canónico."
    )
    inv_raw = await _llm(*_inv_model(), f"thesis-inv-trend-{datetime.now(timezone.utc).timestamp()}",
                         INVESTIGATOR_TREND_SYS, inv_user)
    inv = _extract_json(inv_raw)
    companies = inv.get("companies") or []
    if not companies:
        raise ValueError("El investigador no pudo identificar empresas para esta tendencia. Prueba a reformularla.")

    syn = await _synthesize_companies(trend, inv.get("summary", ""), companies)
    syn_list = syn.get("companies") or []
    score_by_ticker = {c.get("ticker", "").upper(): c for c in syn_list}

    merged = []
    for idx, c in enumerate(companies):
        tk = (c.get("ticker") or "").upper().strip()
        s = score_by_ticker.get(tk) or (syn_list[idx] if idx < len(syn_list) else {})
        scores = {d: _clamp_score((s.get("scores") or {}).get(d)) for d in SCORE_DIMENSIONS}
        cat = (c.get("category") or "leader").strip().lower()
        if cat not in ("leader", "disruptor"):
            cat = "leader"
        merged.append({
            "name": c.get("name"),
            "ticker": tk,
            "value_chain_role": c.get("value_chain_role"),
            "category": cat,
            "why": c.get("why"),
            "scores": scores,
            "trend_exposure": _clamp_score(s.get("trend_exposure")),
            "overall_score": _clamp_score(s.get("overall_score")),
            "thesis": s.get("thesis"),
            "key_risks": s.get("key_risks"),
        })
    merged.sort(key=lambda x: (x["overall_score"] is None, -(x["overall_score"] or 0)))

    return {
        "type": "trend",
        "query": trend,
        "title": inv.get("title") or trend,
        "summary": inv.get("summary"),
        "tam": _normalize_tam(inv.get("tam")),
        "probability": _clamp10(syn.get("thesis_probability")),
        "probability_rationale": syn.get("thesis_probability_rationale"),
        "value_chain": _normalize_value_chain(inv.get("value_chain")),
        "companies": merged,
        "contra": None,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def run_trend_explore(trend: str, sources: list) -> dict:
    """Lightweight STRUCTURAL-ONLY trend exploration (no scoring → cheaper).
    ONE LLM call: maps the value chain + ≥1 leader and ≥1 disruptor per stage, each
    company with its role (líder/disruptor) and a short prominence note. Used by the
    informational 'Tendencias → Empresas' and 'Tendencia automática' flows."""
    sources_block = _sources_block(sources)
    inv_user = (
        f"TENDENCIA / TEMA A ANALIZAR: {trend}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{sources_block}\n\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "title": "título corto de la tendencia",\n'
        '  "summary": "2-3 frases sobre por qué es una megatendencia relevante para invertir",\n'
        '  "tam": {"global_busd": 0, "year": 2027, "note": "1 frase: alcance y supuesto del TAM global"},\n'
        '  "value_chain": [{"stage": "nombre del eslabón", "description": "qué ocurre aquí", "tam_busd": 0}],\n'
        '  "companies": [{"name": "Nombre", "ticker": "TICKER", "value_chain_role": "nombre EXACTO del eslabón (igual que en value_chain)", "category": "leader|disruptor", "why": "1-2 frases sobre su papel y protagonismo: por qué es líder o disruptor de ese eslabón"}]\n'
        "}\n"
        "REGLAS:\n"
        "- 'global_busd' y 'tam_busd' son números en miles de millones de USD a 2027 (TTM).\n"
        "- Para CADA eslabón de value_chain debe haber AL MENOS 1 empresa 'leader' Y AL MENOS 1 'disruptor'.\n"
        "- 'value_chain_role' de cada empresa debe coincidir EXACTAMENTE con un 'stage' de value_chain.\n"
        "- Usa 3-5 eslabones y todas las empresas reales y cotizadas con su TICKER canónico."
    )
    inv_raw = await _llm(*_inv_model(), f"thesis-explore-{datetime.now(timezone.utc).timestamp()}",
                         INVESTIGATOR_TREND_SYS, inv_user)
    inv = _extract_json(inv_raw)
    companies = inv.get("companies") or []
    if not companies:
        raise ValueError("No se pudieron identificar empresas para esta tendencia. Prueba a reformularla.")
    merged = []
    for c in companies:
        tk = (c.get("ticker") or "").upper().strip()
        cat = (c.get("category") or "leader").strip().lower()
        if cat not in ("leader", "disruptor"):
            cat = "leader"
        merged.append({
            "name": c.get("name"),
            "ticker": tk or None,
            "value_chain_role": c.get("value_chain_role"),
            "category": cat,
            "why": c.get("why"),
        })
    return {
        "type": "tendencia",
        "query": trend,
        "title": inv.get("title") or trend,
        "summary": inv.get("summary"),
        "tam": _normalize_tam(inv.get("tam")),
        "value_chain": _normalize_value_chain(inv.get("value_chain")),
        "companies": merged,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


SYNTHESIZER_TREND_SYS = (
    "Eres un gestor de carteras value con criterio cualitativo riguroso. Recibes una "
    "tendencia y una lista de empresas con su rol en la cadena de valor. Para cada empresa "
    "asignas: cuatro puntuaciones cualitativas de 0 a 100 (mayor = mejor), una EXPOSICIÓN a la "
    "tendencia de 0 a 100 (qué porcentaje aproximado del VALOR/negocio de la empresa depende de "
    "esta tendencia: 100 = pure-play totalmente expuesto, 5-15 = la tendencia es un nicho menor "
    "dentro de un negocio mucho mayor), y un SCORE GLOBAL de 0 a 100 que mide qué tan buena es la "
    "empresa COMO VEHÍCULO PARA ESTA TESIS. El score global DEBE ponderar la exposición: una "
    "empresa excelente pero con baja exposición a la tendencia (la tendencia le mueve poco la "
    "aguja) debe tener un score global MENOR que otra igual de buena pero muy expuesta. También "
    "estimas la PROBABILIDAD (entero 0 a 10, 0 = muy improbable, 10 = certeza casi absoluta) de "
    "que la tesis se materialice, calibrada según la evidencia, con una justificación breve. "
    "Sé exigente: reserva >85 para líderes claros y muy expuestos, y probabilidades >=8 solo para "
    "tendencias con evidencia muy sólida. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


async def _synthesize_companies(trend: str, summary: str, companies: list) -> dict:
    lst = "\n".join(
        f"- {c.get('name')} ({c.get('ticker')}) — rol: {c.get('value_chain_role')}. {c.get('why')}"
        for c in companies
    )
    user = (
        f"TENDENCIA: {trend}\nCONTEXTO: {summary}\n\nEMPRESAS:\n{lst}\n\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "thesis_probability": 0-10,\n'
        '  "thesis_probability_rationale": "1-2 frases justificando la probabilidad de que la tesis se cumpla",\n'
        '  "companies": [{\n'
        '    "ticker": "TICKER",\n'
        '    "scores": {"competitive_position": 0-100, "sector_momentum": 0-100, "management_quality": 0-100, "financial_resilience": 0-100},\n'
        '    "trend_exposure": 0-100,\n'
        '    "overall_score": 0-100,\n'
        '    "thesis": "2-3 frases: por qué (o por qué no) es una buena forma de jugar esta tendencia",\n'
        '    "key_risks": "1-2 riesgos cualitativos clave"\n'
        "  }]\n"
        "}\n"
        "Recuerda: 'overall_score' debe ponderar 'trend_exposure' (a menor exposición, menor score global). "
        "Incluye TODAS las empresas de la lista, usando exactamente su mismo TICKER."
    )
    raw = await _llm(*_syn_model(), f"thesis-syn-trend-{datetime.now(timezone.utc).timestamp()}",
                     SYNTHESIZER_TREND_SYS, user)
    return _extract_json(raw)


# ---------------------- Auto-discovery: emerging trends ----------------------

DISCOVERER_SYS = (
    "Eres un analista macro que detecta MEGATENDENCIAS EMERGENTES de inversión a partir de "
    "señales recientes (noticias, informes de analistas, papers, foros). Propones tendencias "
    "estructurales e INVERTIBLES (no modas pasajeras), claramente distintas entre sí. Para cada "
    "una das un 'heat' de 0 a 10 (cuánto momentum/atención tiene AHORA mismo). Usas los "
    "resultados REALES de búsqueda, NO inventas. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)


async def run_discover(exclude: list = None) -> dict:
    sources = gather_discovery_sources()
    now = datetime.now(timezone.utc).strftime("%Y-%m")
    exclude = [str(x).strip() for x in (exclude or []) if str(x).strip()]
    excl_line = (
        "EVITA proponer estas tendencias (ya mostradas/guardadas), busca temas NUEVOS y distintos: "
        + "; ".join(exclude[:40]) + ".\n\n"
    ) if exclude else ""
    user = (
        f"FECHA ACTUAL: {now}\n\n"
        f"{excl_line}"
        f"SEÑALES RECIENTES DE LA WEB:\n{_sources_block(sources)}\n\n"
        "Identifica entre 4 y 5 megatendencias emergentes de inversión, distintas entre sí, "
        "que merezcan una tesis a fondo. Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "candidates": [{\n'
        '    "name": "nombre claro y específico de la tendencia (servirá para generar la tesis)",\n'
        '    "sector": "sector o ámbito",\n'
        '    "why_now": "1-2 frases: por qué está emergiendo justo ahora",\n'
        '    "heat": 0-10\n'
        "  }]\n"
        "}\n"
        "Ordena de mayor a menor 'heat'. Evita tendencias genéricas ya muy maduras."
    )
    raw = await _llm(*_inv_model(), f"thesis-discover-{datetime.now(timezone.utc).timestamp()}",
                     DISCOVERER_SYS, user)
    data = _extract_json(raw)
    candidates = []
    for c in (data.get("candidates") or []):
        name = (c.get("name") or "").strip()
        if not name:
            continue
        candidates.append({
            "name": name,
            "sector": c.get("sector"),
            "why_now": c.get("why_now"),
            "heat": _clamp10(c.get("heat")),
        })
    if not candidates:
        raise ValueError("No se pudieron detectar tendencias emergentes ahora mismo. Inténtalo de nuevo.")
    candidates.sort(key=lambda x: (x["heat"] is None, -(x["heat"] or 0)))
    return {
        "candidates": candidates,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def run_auto_trend(exclude: list = None) -> dict:
    """One-shot automatic trend: discover ONE emerging trend (avoiding the ones in
    `exclude`, by name) based on current momentum, then build its informational
    (structural-only) exploration via run_trend_explore. Returns a 'tendencia' dict
    enriched with the discovery meta (heat / why_now / sector)."""
    exclude = exclude or []
    excl_norm = {(_norm_name(x)) for x in exclude}
    disc = await run_discover(exclude=exclude)
    candidate = None
    for c in (disc.get("candidates") or []):
        if _norm_name(c.get("name")) not in excl_norm:
            candidate = c
            break
    if not candidate:
        candidate = (disc.get("candidates") or [None])[0]
    if not candidate or not (candidate.get("name") or "").strip():
        raise ValueError("No se pudo detectar una tendencia nueva ahora mismo. Inténtalo de nuevo.")
    name = candidate["name"].strip()
    sources = gather_sources(name, "trend")
    result = await run_trend_explore(name, sources)
    result["heat"] = candidate.get("heat")
    result["why_now"] = candidate.get("why_now")
    result["sector"] = candidate.get("sector")
    result["auto"] = True
    return result


def _norm_name(s) -> str:
    return (s or "").strip().lower()


# ---------------------- Weekly news watch (cheap classifier) ----------------------

NEWS_WATCH_SYS = (
    "Eres un analista de inversión que vigila NOTICIAS MATERIALES sobre las megatendencias "
    "que sigue un inversor. Te doy su lista de tendencias y resultados REALES de búsqueda web "
    "recientes. Identifica SOLO desarrollos verdaderamente importantes y materiales de los "
    "últimos días (rupturas tecnológicas, regulación relevante, grandes movimientos "
    "competitivos, resultados que cambian la tesis). Si no hay nada material, devuelve lista "
    "vacía — sé exigente, NO inventes. Usa el NOMBRE EXACTO de la tendencia tal como aparece "
    "en la lista. Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


async def run_news_watch(trend_titles: list) -> dict:
    """One cheap LLM classification over live news for the user's saved trends.
    Returns {"important": [{trend, headline, summary, why_it_matters, tickers[]}]}.
    Usually empty — only flags genuinely material developments."""
    titles = [t for t in (trend_titles or []) if t]
    if not titles:
        return {"important": []}
    year = datetime.now(timezone.utc).year
    queries = [f"{t} noticias novedades {year}" for t in titles[:6]]
    queries += [f"{t} breakthrough regulation earnings {year}" for t in titles[:4]]
    sources = _run_searches(queries, max_results=4, cap=24)
    user_text = (
        "TENDENCIAS QUE SIGUE EL INVERSOR:\n" + "\n".join(f"- {t}" for t in titles) +
        "\n\nRESULTADOS DE BÚSQUEDA WEB RECIENTES:\n" + _sources_block(sources) +
        "\n\nDevuelve SOLO JSON con esta forma:\n"
        '{"important":[{"trend":"<nombre EXACTO de la lista>","headline":"titular breve",'
        '"summary":"2-3 frases","why_it_matters":"por qué cambia o refuerza la tesis",'
        '"tickers":["TICKERS afectados"]}]}\n'
        "Si no hay nada material esta semana, devuelve {\"important\":[]}."
    )
    raw = await _llm(*_inv_model(), f"news-watch-{datetime.now(timezone.utc).timestamp()}",
                     NEWS_WATCH_SYS, user_text)
    data = _extract_json(raw)
    out = []
    for it in (data.get("important") or [])[:5]:
        trend = (it.get("trend") or "").strip()
        if not trend:
            continue
        out.append({
            "trend": trend,
            "headline": (it.get("headline") or "").strip(),
            "summary": (it.get("summary") or "").strip(),
            "why_it_matters": (it.get("why_it_matters") or "").strip(),
            "tickers": [str(x).upper().strip() for x in (it.get("tickers") or []) if x][:6],
        })
    return {"important": out}


# ---------------------- Flow B: Company → growth-driver theses (3 passes) ----------------------
# A thesis = a HIGH-CONVICTION bet on an INDEPENDENT growth driver (own, non-overlapping
# TAM), tagged Actual (core in expansion) or Futura (future bet / adjacency).
#   Pass 1 (_map_growth_drivers): map current sub-drivers + future/adjacent bets.
#   Pass 2 (_reconcile_drivers): merge correlated drivers, drop low conviction, keep TAMs
#           mutually exclusive (highest non-overlapping). Qualitative, no deterministic rule.
#   Pass 3 (_synthesize_company_trends): score relevance + win_probability.

GROWTH_DRIVER_MAPPER_SYS = (
    "Eres un analista de equity research senior. Una TESIS es una apuesta de ALTA CONVICCIÓN sobre un "
    "DRIVER DE CRECIMIENTO independiente de la empresa, con TAM propio y NO solapado con los demás. "
    "Recibes resultados REALES de búsqueda web reciente sobre una empresa cotizada. Tu tarea (PASO 1 de 3) "
    "es MAPEAR sus drivers de crecimiento, de DOS tipos: "
    "ACTUALES: negocios que hoy crecen a tasas altas; en empresas grandes, DESCOMPÓN el núcleo en sus "
    "sub-drivers INDEPENDIENTES (cada uno con dinámica de demanda y TAM propios; p.ej. en cómputo de IA, "
    "entrenamiento e inferencia son drivers distintos). "
    "FUTURAS/ADYACENTES: apuestas de futuro (con poca o nula tracción hoy) y áreas adyacentes con "
    "sinergias que expanden el negocio y refuerzan las barreras de entrada (moat). "
    "PRINCIPIO DE DRIVER INDEPENDIENTE: dos cosas son drivers DISTINTOS si su crecimiento es en gran "
    "medida INDEPENDIENTE (causas de demanda distintas y TAM propio); si crecen por la MISMA causa "
    "(demanda correlacionada, mismo pool de TAM, módulos de una misma plataforma vendida junta), son UN "
    "solo driver (no los separes). "
    "TAM: a cada driver asígnale el TAM MÁS ALTO posible que NO se solape con el de los demás (mutuamente "
    "excluyentes). CONVICCIÓN: prioriza drivers de alta convicción = fuertes en (i) viento de cola "
    "estructural, (ii) derecho a ganar de la empresa (posición/activos/compromiso estratégico) y (iii) TAM "
    "dimensionable. El NÚMERO de drivers EMERGE de la empresa (una gran diversificada dará varios; una "
    "focalizada, pocos + quizá 1 adyacencia); no fuerces un número. Confirma el TICKER canónico (formato "
    "Yahoo Finance). Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)

DRIVER_RECONCILER_SYS = (
    "Eres un analista de equity research senior. Recibes una empresa y una lista PRELIMINAR de drivers de "
    "crecimiento. Tu tarea (PASO 2 de 3) es DEPURARLA hasta dejar un conjunto de tesis de ALTA CONVICCIÓN "
    "con TAMs MUTUAMENTE EXCLUYENTES (sin solaparse) y lo más altos posible: "
    "(1) FUSIONA los drivers que crezcan por la MISMA causa de demanda o que compartan el mismo pool de "
    "TAM (p.ej. módulos de una plataforma vendida junta como una suite → un solo driver). "
    "(2) DESCARTA los de convicción baja o especulativos sin compromiso real. "
    "(3) Asegura que NINGÚN driver sea un sub-conjunto de otro (no devuelvas un negocio y su sub-driver a "
    "la vez): elige el nivel en que los drivers son INDEPENDIENTES entre sí. "
    "(4) Ajusta cada TAM al valor más alto posible que mantenga la EXCLUSIVIDAD mutua (sin doble conteo). "
    "Conserva la etiqueta de tipo (actual/futura) de cada driver. "
    "ADEMÁS: para cada tesis que sea un CORE GRANDE y descomponible en sub-drivers INDEPENDIENTES (p.ej. "
    "cómputo de IA → entrenamiento + inferencia), incluye un desglose OPCIONAL 'splits' con sus sub-partes "
    "independientes cuyos TAM SUMEN aproximadamente el TAM de la tesis (CONSERVACIÓN: no inflar el total). "
    "Para tesis pequeñas o no descomponibles, deja 'splits' como lista VACÍA. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)


async def _map_growth_drivers(company: str, sources_block: str) -> dict:
    """Pass 1 (GPT-5.2): map the company's current sub-drivers + future/adjacent bets."""
    user = (
        f"EMPRESA A ANALIZAR (nombre o ticker): {company}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{sources_block}\n\n"
        "Mapea los DRIVERS DE CRECIMIENTO (actuales y futuros/adyacentes). Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "company": {"name": "Nombre oficial", "ticker": "TICKER"},\n'
        '  "summary": "2-3 frases sobre el negocio y sus motores de crecimiento",\n'
        '  "drivers": [{"name": "driver de crecimiento concreto", "type": "actual|futura", "demand_driver": "qué causa su crecimiento (la fuente de demanda)", "conviction_rationale": "por qué es de alta convicción: viento de cola + derecho a ganar + evidencia", "tam_busd": 0}]\n'
        "}\n"
        "REGLAS:\n"
        "- Drivers INDEPENDIENTES: si dos crecen por la misma causa o comparten el mismo pool de TAM, fusiónalos en uno.\n"
        "- 'tam_busd' = el TAM más alto posible del driver SIN solaparse con los demás (USD miles de millones, 2027e).\n"
        "- Incluye apuestas FUTURAS aunque tengan poca tracción si son de alta convicción (márcalas type='futura').\n"
        "- Para una empresa cotizada real, devuelve AL MENOS 1 driver (NO dejes la lista vacía salvo que la empresa no exista o no cotice)."
    )
    mp = {}
    for attempt in range(2):  # retry once on a transient empty result
        raw = await _llm(*_inv_model(), f"thesis-map-{attempt}-{datetime.now(timezone.utc).timestamp()}",
                         GROWTH_DRIVER_MAPPER_SYS, user)
        mp = _extract_json(raw)
        if mp.get("drivers"):
            break
    return mp


async def _reconcile_drivers(company: str, drivers: list, sources_block: str) -> list:
    """Pass 2 (GPT-5.2): merge correlated drivers, drop low conviction, keep TAMs
    mutually exclusive. Returns the final, non-overlapping high-conviction set."""
    drivers_block = "\n".join(
        f"- [{(d.get('type') or '').lower()}] {d.get('name')} (TAM ~${d.get('tam_busd')}B; driver: "
        f"{d.get('demand_driver') or '?'}). {(d.get('conviction_rationale') or '')[:200]}"
        for d in drivers if d.get("name")
    ) or "(ninguno)"
    user = (
        f"EMPRESA: {company}\n\nDRIVERS PRELIMINARES:\n{drivers_block}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{sources_block}\n\n"
        "Depura la lista (fusiona correlacionados, descarta baja convicción, garantiza TAMs mutuamente "
        "excluyentes y lo más altos posible, sin que un driver sea sub-conjunto de otro). Devuelve un JSON "
        "con esta forma EXACTA:\n"
        "{\n"
        '  "trends": [{"name": "tesis (driver de crecimiento)", "type": "actual|futura", "demand_driver": "la fuente de demanda que lo mueve", "fit_description": "la apuesta de la empresa y la evidencia/lógica de alta convicción", "value_chain_role": "su rol/posición en la cadena de valor", "tam_busd": 0, "splits": [{"name": "sub-driver independiente", "demand_driver": "su fuente de demanda", "fit_description": "1 frase", "tam_busd": 0}]}]\n'
        "}\n"
        "REGLAS: TAMs mutuamente excluyentes (el más alto posible sin doble conteo); NO incluyas un negocio "
        "y su sub-driver a la vez; conserva la etiqueta type (actual/futura); mantén solo alta convicción; "
        "ordénalos por convicción. 'splits' SOLO para cores grandes descomponibles (sus TAM deben sumar ~el "
        "TAM de la tesis); vacío en el resto."
    )
    trends = []
    for attempt in range(2):  # retry once on a transient empty result
        raw = await _llm(*_inv_model(), f"thesis-recon-{attempt}-{datetime.now(timezone.utc).timestamp()}",
                         DRIVER_RECONCILER_SYS, user)
        data = _extract_json(raw)
        trends = data.get("trends") or []
        if trends:
            break
    return trends


def _norm_type(v) -> str:
    t = (v or "").strip().lower()
    if t in ("actual", "actuales", "current"):
        return "actual"
    if t in ("futura", "futuras", "future", "futuro", "adyacente", "adyacencia"):
        return "futura"
    return "actual"


def _build_splits(raw_splits, parent_tam):
    """Optional decomposition of a large core driver into independent sub-drivers.
    Rescales the sub-parts' TAM proportionally so they sum EXACTLY to the parent
    driver's TAM (conservation: no inflation). Returns [] when there is no
    meaningful split (fewer than 2 sub-parts)."""
    splits = []
    for sp in (raw_splits or []):
        if sp.get("name"):
            splits.append({
                "name": sp.get("name"),
                "demand_driver": sp.get("demand_driver"),
                "fit_description": sp.get("fit_description"),
                "tam_busd": _busd(sp.get("tam_busd")),
            })
    if len(splits) < 2:
        return []
    total = sum(s["tam_busd"] for s in splits if s["tam_busd"] is not None)
    if parent_tam and total and all(s["tam_busd"] is not None for s in splits):
        for s in splits:
            s["tam_busd"] = round(s["tam_busd"] * parent_tam / total, 1)
    return splits


async def run_company_thesis(company: str, sources: list) -> dict:
    sources_block = _sources_block(sources)

    # Pass 1: map current + future/adjacent growth drivers.
    mp = await _map_growth_drivers(company, sources_block)
    drivers = mp.get("drivers") or []
    if not drivers:
        raise ValueError("No se pudieron identificar drivers de crecimiento para esta empresa. Revisa el nombre o ticker.")
    comp = mp.get("company") or {}

    # Pass 2: reconcile into a non-overlapping, high-conviction set.
    trends = await _reconcile_drivers(comp.get("name") or company, drivers, sources_block)
    if not trends:
        # Fallback: use the mapped drivers directly so the user still gets a result.
        trends = [{
            "name": d.get("name"), "type": d.get("type"),
            "demand_driver": d.get("demand_driver"),
            "fit_description": d.get("conviction_rationale"),
            "value_chain_role": None, "tam_busd": d.get("tam_busd"),
        } for d in drivers if d.get("name")]

    # Pass 3: qualitative scoring of the final theses.
    syn = await _synthesize_company_trends(comp.get("name") or company, trends)
    syn_trends = syn.get("trends") or []
    aligned = _align_syn_trends(trends, syn_trends)

    merged = []
    for t, s in zip(trends, aligned):
        tam = _busd(t.get("tam_busd"))
        merged.append({
            "name": t.get("name"),
            "type": _norm_type(t.get("type")),
            "demand_driver": t.get("demand_driver"),
            "fit_description": t.get("fit_description"),
            "value_chain_role": t.get("value_chain_role"),
            "relevance_score": _clamp_score(s.get("relevance_score")),
            "win_probability": _clamp10(s.get("win_probability")),
            "rationale": s.get("rationale"),
            "tam_busd": tam,
            "splits": _build_splits(t.get("splits"), tam),
        })
    merged.sort(key=lambda x: (x["relevance_score"] is None, -(x["relevance_score"] or 0)))

    overall_relevance = _clamp_score(syn.get("overall_relevance"))
    relevance_unavailable = overall_relevance is None and not any(
        m["relevance_score"] is not None for m in merged
    )

    return {
        "type": "company",
        "query": company,
        "company": {"name": comp.get("name") or company, "ticker": (comp.get("ticker") or "").upper().strip()},
        "title": comp.get("name") or company,
        "summary": mp.get("summary"),
        "probability": _clamp10(syn.get("overall_probability")),
        "probability_rationale": syn.get("overall_probability_rationale"),
        "trends": merged,
        "overall_relevance": overall_relevance,
        "flags": {"relevance_unavailable": relevance_unavailable},
        "contra": None,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


SYNTHESIZER_COMPANY_SYS = (
    "Eres un estratega de inversión. Recibes una empresa y una lista de SEGMENTOS DE NEGOCIO ganadores "
    "(granulares, con entidad propia) en los que la empresa apuesta. Asignas a cada segmento un score de "
    "RELEVANCIA de 0 a 100 que refleja el COMPROMISO ESTRATÉGICO de la empresa con ese segmento y la "
    "TRACCIÓN observada (NO la mera relevancia tangencial), y una PROBABILIDAD GANADORA (entero 0 a 10) de "
    "que ese segmento sea estructuralmente ganador / con momentum, con una justificación breve que explique "
    "cómo la empresa está AUMENTANDO su participación y la evidencia concreta. También das un score global de "
    "relevancia temática y estimas la PROBABILIDAD (entero 0 a 10) de que la tesis alcista GANADORA se "
    "materialice, con una justificación breve. Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


def _align_syn_trends(inv_trends: list, syn_trends: list) -> list:
    """Align synthesizer trend objects to the investigator trends: exact name → token
    overlap → positional, each consumed once. Prevents a reworded name from silently
    dropping the relevance/rationale (root cause of empty relevance)."""
    norm = [(i, (st.get("name") or "").strip().lower()) for i, st in enumerate(syn_trends)]
    used, out = set(), []
    for idx, t in enumerate(inv_trends):
        key = (t.get("name") or "").strip().lower()
        chosen = None
        for i, nm in norm:  # exact
            if i not in used and nm == key:
                chosen = i
                break
        if chosen is None and key:  # token overlap
            kset = set(key.split())
            best_i, best_score = None, 0.0
            for i, nm in norm:
                if i in used:
                    continue
                sset = set(nm.split())
                union = len(kset | sset)
                score = (len(kset & sset) / union) if union else 0.0
                if score > best_score:
                    best_i, best_score = i, score
            if best_i is not None and best_score >= 0.3:
                chosen = best_i
        if chosen is None and idx < len(syn_trends) and idx not in used:  # positional
            chosen = idx
        if chosen is not None:
            used.add(chosen)
            out.append(syn_trends[chosen])
        else:
            out.append({})
    return out


async def _synthesize_company_trends(company: str, trends: list) -> dict:
    lst = "\n".join(f"- {t.get('name')}: {t.get('fit_description')}" for t in trends)
    user = (
        f"EMPRESA: {company}\n\nSEGMENTOS DE NEGOCIO GANADORES:\n{lst}\n\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "overall_relevance": 0-100,\n'
        '  "overall_probability": 0-10,\n'
        '  "overall_probability_rationale": "1-2 frases justificando la probabilidad de la tesis temática ganadora",\n'
        '  "trends": [{"name": "mismo segmento", "relevance_score": 0-100, "win_probability": 0-10, "rationale": "1-2 frases: cómo la empresa AUMENTA su participación en este segmento y la evidencia/resultado observado"}]\n'
        "}\n"
        "Incluye TODOS los segmentos con su mismo nombre."
    )
    data = {}
    for attempt in range(2):  # retry once: a transient parse/LLM miss left relevance blank
        raw = await _llm(*_syn_model(),
                         f"thesis-syn-co-{attempt}-{datetime.now(timezone.utc).timestamp()}",
                         SYNTHESIZER_COMPANY_SYS, user)
        data = _extract_json(raw)
        if data.get("overall_relevance") is not None or data.get("trends"):
            return data
    return data


# ---------------------- Contra-thesis (antítesis, bajo demanda) ----------------------

CONTRA_INVESTIGATOR_TREND_SYS = (
    "Eres un analista de equity research que identifica a los PERDEDORES de una megatendencia. "
    "Premisa CLAVE: la tesis alcista SÍ se materializa. Toda tendencia que crea ganadores también "
    "crea perdedores como CONSECUENCIA DERIVADA de que ocurra: sectores y empresas cotizadas que "
    "se ven perjudicados por disrupción, comoditización, sustitución, desintermediación o presión "
    "de márgenes PRECISAMENTE PORQUE la tendencia avanza. NO es el escenario en que la tesis falla: "
    "tesis y contratesis son COMPATIBLES y ambas pueden tener probabilidad alta. Usas resultados "
    "REALES de búsqueda web reciente, NO inventas. Identifica empresas cotizadas con su TICKER "
    "canónico (formato Yahoo Finance). "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)

CONTRA_INVESTIGATOR_COMPANY_SYS = (
    "Eres un analista de equity research que identifica el RIESGO DE DISRUPCIÓN de una empresa "
    "cotizada. Premisa CLAVE: identifica qué megatendencias o cambios estructurales, AL "
    "MATERIALIZARSE, dejarían a esta empresa en el LADO PERDEDOR (le harían perder valor por "
    "disrupción, sustitución, comoditización o desintermediación). No es que el mercado caiga: "
    "es que el cambio ocurre y la empresa lo sufre. Usas resultados REALES de búsqueda web "
    "reciente, NO inventas. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)

CONTRA_SYNTHESIZER_SYS = (
    "Eres un estratega de inversión. Recibes una CONTRATESIS: una consecuencia negativa DERIVADA "
    "de que una megatendencia se materialice (los perdedores del cambio). Estimas la PROBABILIDAD "
    "(entero 0 a 10, 0 = muy improbable, 10 = casi seguro) de que esa consecuencia negativa "
    "OCURRA. Importante: puede ser ALTA y es COMPATIBLE con que la tesis alcista también tenga "
    "probabilidad alta (no son excluyentes). Calíbrala con la evidencia y justifícala brevemente. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


async def _contra_probability(summary: str) -> dict:
    user = (
        f"CONTRATESIS (consecuencia negativa derivada de que la tendencia ocurra):\n{summary}\n\n"
        "Estima la probabilidad de que esa consecuencia negativa se materialice (puede ser alta "
        "y compatible con la tesis alcista). Devuelve un JSON con esta forma EXACTA:\n"
        '{ "probability": 0-10, "probability_rationale": "1-2 frases" }'
    )
    raw = await _llm(*_syn_model(), f"thesis-contra-syn-{datetime.now(timezone.utc).timestamp()}",
                     CONTRA_SYNTHESIZER_SYS, user)
    return _extract_json(raw)


async def run_trend_contra(title: str, summary: str) -> dict:
    sources = gather_sources(
        f"{title} perdedores disrupción comoditización sustitución sectores perjudicados", "trend")
    inv_user = (
        f"TESIS ORIGINAL (alcista, que SÍ se materializa): {title}\nCONTEXTO: {summary}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{_sources_block(sources)}\n\n"
        "Construye la CONTRATESIS: dado que esta tendencia AVANZA, ¿qué efecto negativo derivado "
        "provoca y QUIÉN pierde? (sectores/empresas perjudicados por disrupción, comoditización, "
        "sustitución o presión de márgenes precisamente porque la tendencia ocurre). "
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "summary": "2-3 frases: qué consecuencia negativa derivada provoca que la tendencia se cumpla, y por qué",\n'
        '  "value_chain": [{"stage": "sector/eslabón perjudicado", "description": "cómo y por qué pierde al avanzar la tendencia"}],\n'
        '  "companies": [{"name": "Nombre", "ticker": "TICKER", "harm_reason": "1-2 frases sobre por qué esta empresa cotizada sale perjudicada"}]\n'
        "}\n"
        "Incluye entre 3 y 6 empresas cotizadas reales perjudicadas, con su TICKER canónico."
    )
    inv_raw = await _llm(*_inv_model(), f"thesis-contra-inv-trend-{datetime.now(timezone.utc).timestamp()}",
                         CONTRA_INVESTIGATOR_TREND_SYS, inv_user)
    inv = _extract_json(inv_raw)
    summary_contra = inv.get("summary") or ""
    prob = await _contra_probability(summary_contra)
    companies = []
    for c in (inv.get("companies") or []):
        companies.append({
            "name": c.get("name"),
            "ticker": (c.get("ticker") or "").upper().strip(),
            "harm_reason": c.get("harm_reason"),
        })
    return {
        "kind": "trend",
        "summary": summary_contra,
        "probability": _clamp10(prob.get("probability")),
        "probability_rationale": prob.get("probability_rationale"),
        "value_chain": inv.get("value_chain") or [],
        "companies": companies,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def run_company_contra(company: str, summary: str) -> dict:
    sources = gather_sources(
        f"{company} riesgo disrupción sustitución comoditización pérdida cuota amenaza estructural", "company")
    inv_user = (
        f"EMPRESA: {company}\nCONTEXTO: {summary}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{_sources_block(sources)}\n\n"
        "Construye la CONTRATESIS: ¿qué megatendencias o cambios estructurales, AL MATERIALIZARSE, "
        "dejarían a esta empresa en el lado PERDEDOR (disrupción/sustitución/comoditización)? "
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "summary": "2-3 frases: qué cambio estructural, al ocurrir, haría perder valor a la empresa",\n'
        '  "losing_trends": [{"name": "tendencia/cambio que la perjudica al avanzar", "harm_reason": "1-2 frases sobre el daño derivado"}]\n'
        "}\n"
        "Incluye entre 2 y 5 tendencias/cambios perjudiciales."
    )
    inv_raw = await _llm(*_inv_model(), f"thesis-contra-inv-co-{datetime.now(timezone.utc).timestamp()}",
                         CONTRA_INVESTIGATOR_COMPANY_SYS, inv_user)
    inv = _extract_json(inv_raw)
    summary_contra = inv.get("summary") or ""
    prob = await _contra_probability(summary_contra)
    return {
        "kind": "company",
        "summary": summary_contra,
        "probability": _clamp10(prob.get("probability")),
        "probability_rationale": prob.get("probability_rationale"),
        "losing_trends": inv.get("losing_trends") or [],
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------- F5: Cross-linking company ↔ existing theses ----------------------

MATCHER_SYS = (
    "Eres un analista que relaciona las tendencias GANADORAS de una empresa con las TESIS de "
    "tendencia que el usuario ya tiene guardadas. Dos tendencias 'coinciden' si tratan el MISMO "
    "tema estructural aunque el nombre difiera. Solo debes asociar (to_add) o sugerir como nueva "
    "(to_create) una tendencia cuando la empresa sea un GANADOR/participante estratégico con algún "
    "resultado observable en ese tema; si una tendencia no lo cumple, NO la incluyas en ninguna "
    "lista. Ambas listas PUEDEN quedar vacías. Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


def _resolve_trend_name(returned: str, company_trends: list) -> str:
    """Map a (possibly rephrased) trend name from the LLM back to the EXACT company
    trend string, so the frontend can match it reliably. Falls back to the original."""
    rn = (returned or "").strip().lower()
    if not rn or not company_trends:
        return returned
    for ct in company_trends:  # exact
        if (ct or "").strip().lower() == rn:
            return ct
    for ct in company_trends:  # substring either direction
        c = (ct or "").strip().lower()
        if c and (rn in c or c in rn):
            return ct
    # token (Jaccard) overlap fallback
    rset = set(rn.split())
    best, best_score = None, 0.0
    for ct in company_trends:
        cset = set((ct or "").strip().lower().split())
        if not cset:
            continue
        inter = len(rset & cset)
        union = len(rset | cset)
        score = inter / union if union else 0.0
        if score > best_score:
            best, best_score = ct, score
    return best if best_score >= 0.34 else returned


async def match_company_to_theses(company: str, company_trends: list, existing: list) -> dict:
    """existing: [{'id', 'title'}]. company_trends: [str]. Returns {to_add, to_create}."""
    valid_ids = {e["id"] for e in existing}
    existing_list = "\n".join(f"- id={e['id']} :: {e['title']}" for e in existing) or "(ninguna)"
    trends_list = "\n".join(f"- {t}" for t in company_trends) or "(ninguna)"
    user = (
        f"EMPRESA: {company}\n\n"
        f"TENDENCIAS EN LAS QUE ENCAJA LA EMPRESA:\n{trends_list}\n\n"
        f"TESIS DE TENDENCIA YA EXISTENTES DEL USUARIO:\n{existing_list}\n\n"
        "Para cada tendencia de la empresa, decide si corresponde a una tesis existente (mismo tema) o no.\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "to_add": [{"thesis_id": "id EXACTO de la lista", "thesis_title": "título", "trend_name": "COPIA LITERAL de la tendencia de la empresa", "reason": "1 frase: por qué la empresa es un ganador estratégico en esta tesis y la evidencia/resultado"}],\n'
        '  "to_create": [{"trend_name": "COPIA LITERAL de la tendencia sin tesis asociada", "why": "1 frase: por qué es una tesis ganadora y la empresa apuesta estratégicamente por ella con resultados"}]\n'
        "}\n"
        "IMPORTANTE: 'trend_name' debe ser una COPIA EXACTA (carácter por carácter) de una de las tendencias listadas arriba. "
        "Usa SOLO los id que aparecen en la lista para 'to_add'. Si no hay tesis existentes, las tendencias ganadoras van en 'to_create'. "
        "No repitas la misma tendencia en ambas listas. Si ninguna tendencia cumple el criterio ganador/estratégico, devuelve ambas listas VACÍAS."
    )
    raw = await _llm(*_syn_model(), f"thesis-match-{datetime.now(timezone.utc).timestamp()}",
                     MATCHER_SYS, user)
    data = _extract_json(raw)
    to_add = []
    for a in (data.get("to_add") or []):
        if a.get("thesis_id") in valid_ids:
            a["trend_name"] = _resolve_trend_name(a.get("trend_name"), company_trends)
            to_add.append(a)
    to_create = []
    for c in (data.get("to_create") or []):
        if (c.get("trend_name") or "").strip():
            c["trend_name"] = _resolve_trend_name(c.get("trend_name"), company_trends)
            to_create.append(c)
    return {"to_add": to_add, "to_create": to_create}


EVALUATOR_SYS = (
    "Eres un analista de equity research senior. Evalúas una empresa cotizada DENTRO de una "
    "tendencia concreta y su cadena de valor: su rol, si es líder o disruptor, sus scores "
    "cualitativos (0-100, mayor = mejor), y su EXPOSICIÓN a la tendencia (0-100: qué % del valor "
    "de la empresa depende de esta tendencia). El score global debe ponderar la exposición "
    "(a menor exposición, menor score global). Sé exigente. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


async def evaluate_company_for_trend(trend_title: str, summary: str, value_chain: list,
                                     company_name: str, company_ticker: str) -> dict:
    stages = "; ".join(s.get("stage") for s in (value_chain or []) if s.get("stage")) or "(sin definir)"
    user = (
        f"TENDENCIA: {trend_title}\nCONTEXTO: {summary}\nESLABONES DE LA CADENA DE VALOR: {stages}\n\n"
        f"EMPRESA A EVALUAR: {company_name} ({company_ticker})\n\n"
        "Evalúa la empresa dentro de esta tendencia. Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "name": "Nombre", "ticker": "TICKER",\n'
        '  "value_chain_role": "uno de los eslabones (o el más cercano)",\n'
        '  "category": "leader|disruptor",\n'
        '  "scores": {"competitive_position": 0-100, "sector_momentum": 0-100, "management_quality": 0-100, "financial_resilience": 0-100},\n'
        '  "trend_exposure": 0-100,\n'
        '  "overall_score": 0-100,\n'
        '  "thesis": "2-3 frases sobre su encaje en la tendencia",\n'
        '  "key_risks": "1-2 riesgos clave"\n'
        "}\n"
        "Recuerda: 'overall_score' debe ponderar 'trend_exposure' (a menor exposición, menor score global)."
    )
    raw = await _llm(*_syn_model(), f"thesis-eval-{datetime.now(timezone.utc).timestamp()}",
                     EVALUATOR_SYS, user)
    d = _extract_json(raw)
    cat = (d.get("category") or "leader").strip().lower()
    if cat not in ("leader", "disruptor"):
        cat = "leader"
    return {
        "name": d.get("name") or company_name,
        "ticker": (d.get("ticker") or company_ticker).upper().strip(),
        "value_chain_role": d.get("value_chain_role"),
        "category": cat,
        "scores": {dim: _clamp_score((d.get("scores") or {}).get(dim)) for dim in SCORE_DIMENSIONS},
        "trend_exposure": _clamp_score(d.get("trend_exposure")),
        "overall_score": _clamp_score(d.get("overall_score")),
        "thesis": d.get("thesis"),
        "key_risks": d.get("key_risks"),
        "added_manually": True,
    }


# ---------------- TAM hierarchy: detect a parent (superset) thesis ----------------

PARENT_DETECTOR_SYS = (
    "Eres un analista que detecta JERARQUÍAS de mercado entre tesis de inversión para evitar el "
    "DOBLE CONTEO del TAM (mercado total direccionable). Una tesis es HIJA (sub-segmento) de otra "
    "MADRE cuando su mercado está CONTENIDO dentro del mercado de la madre (ej.: 'Inferencia en la "
    "nube' es hija de 'Centros de datos de IA'; 'Baterías de estado sólido' es hija de "
    "'Almacenamiento de energía'). NO son madre-hija si solo se solapan parcialmente, son temas "
    "hermanos distintos, o la una no contiene a la otra. Responde SIEMPRE en español y SOLO con un "
    "objeto JSON válido, sin texto adicional."
)


async def detect_parent_thesis(new_title: str, new_summary: str, new_tam_busd, existing: list) -> dict:
    """Decide whether the NEW trend thesis is a CHILD (subset) of one of the user's
    existing trend theses. `existing`: [{'id','title','summary','tam_busd'}].
    Returns {'parent_id', 'reason'} when it is a child, else {'parent_id': None}."""
    if not existing:
        return {"parent_id": None}
    valid_ids = {e["id"] for e in existing}
    lst = "\n".join(
        f"- id={e['id']} :: {e.get('title')} (TAM ~${e.get('tam_busd') if e.get('tam_busd') is not None else '?'}B). "
        f"{(e.get('summary') or '')[:220]}"
        for e in existing
    )
    user = (
        f"NUEVA TESIS:\nTítulo: {new_title}\nResumen: {new_summary}\n"
        f"TAM global ~${new_tam_busd if new_tam_busd is not None else '?'}B\n\n"
        f"TESIS EXISTENTES DEL USUARIO:\n{lst}\n\n"
        "¿La NUEVA tesis es una HIJA (sub-segmento cuyo mercado está CONTENIDO) de ALGUNA de las "
        "tesis existentes? Si lo es de varias, elige la MADRE MÁS DIRECTA/cercana. Devuelve un JSON "
        "con esta forma EXACTA:\n"
        '{ "is_child": true|false, "parent_id": "id EXACTO de la madre o null", '
        '"reason": "1 frase: por qué el mercado de la nueva está contenido en el de la madre" }\n'
        "Sé EXIGENTE: responde is_child=false si solo hay solapamiento parcial o son temas hermanos."
    )
    raw = await _llm(*_syn_model(), f"thesis-parent-{datetime.now(timezone.utc).timestamp()}",
                     PARENT_DETECTOR_SYS, user)
    data = _extract_json(raw)
    pid = data.get("parent_id")
    if data.get("is_child") and pid in valid_ids:
        return {"parent_id": pid, "reason": (data.get("reason") or "").strip()}
    return {"parent_id": None}

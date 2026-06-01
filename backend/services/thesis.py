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
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

INVESTIGATOR_MODEL = ("openai", "gpt-5.2")
SYNTHESIZER_MODEL = ("anthropic", "claude-sonnet-4-5-20250929")

SCORE_DIMENSIONS = [
    "competitive_position",
    "sector_momentum",
    "management_quality",
    "financial_resilience",
]


# ---------------------- Live web search (real-time) ----------------------

def gather_sources(subject: str, kind: str, max_results: int = 5) -> list:
    """Run several live DuckDuckGo queries and return de-duplicated results.

    kind: "trend" | "company". Returns [{title, url, snippet}].
    Synchronous (network bound) — the caller runs it in a threadpool.
    """
    try:
        from ddgs import DDGS
    except Exception as e:  # pragma: no cover
        logger.error(f"ddgs import failed: {e}")
        return []

    subject = (subject or "").strip()
    year = datetime.now(timezone.utc).year
    if kind == "company":
        queries = [
            f"{subject} growth drivers macro trends tailwinds {year}",
            f"{subject} business segments industry value chain",
            f"{subject} stock investment thesis outlook {year}",
        ]
    else:
        queries = [
            f"{subject} value chain leading public companies stocks {year}",
            f"{subject} market trend outlook forecast {year}",
            f"{subject} key players suppliers beneficiaries investing",
        ]

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
    return out[:18]


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
    return await chat.send_message(UserMessage(text=user_text))


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


# ---------------------- Flow A: Trend → companies ----------------------

INVESTIGATOR_TREND_SYS = (
    "Eres un analista de equity research senior especializado en mapear cadenas de valor. "
    "Recibes resultados REALES de búsqueda web reciente. Tu trabajo es estructurar la "
    "información, NO inventar. Identifica empresas COTIZADAS con su TICKER bursátil canónico "
    "exacto tal como aparece en Yahoo Finance (ej. NVDA, ASML.AS, TSM, 005930.KS). "
    "Si una empresa no cotiza o no estás seguro del ticker, no la incluyas. "
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
        '  "value_chain": [{"stage": "nombre del eslabón", "description": "qué ocurre aquí"}],\n'
        '  "companies": [{"name": "Nombre", "ticker": "TICKER", "value_chain_role": "eslabón donde encaja", "why": "1-2 frases sobre por qué es líder/relevante"}]\n'
        "}\n"
        "Incluye entre 4 y 8 empresas líderes reales y cotizadas, ordenadas por relevancia. "
        "Cubre distintos eslabones de la cadena (no solo el más obvio)."
    )
    inv_raw = await _llm(*INVESTIGATOR_MODEL, f"thesis-inv-trend-{datetime.now(timezone.utc).timestamp()}",
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
        merged.append({
            "name": c.get("name"),
            "ticker": tk,
            "value_chain_role": c.get("value_chain_role"),
            "why": c.get("why"),
            "scores": scores,
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
        "probability": _clamp10(syn.get("thesis_probability")),
        "probability_rationale": syn.get("thesis_probability_rationale"),
        "value_chain": inv.get("value_chain") or [],
        "companies": merged,
        "contra": None,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


SYNTHESIZER_TREND_SYS = (
    "Eres un gestor de carteras value con criterio cualitativo riguroso. Recibes una "
    "tendencia y una lista de empresas con su rol en la cadena de valor. Asignas puntuaciones "
    "cualitativas de 0 a 100 (mayor = mejor) en cuatro dimensiones y un score global, además "
    "de una tesis breve y los riesgos clave. También estimas la PROBABILIDAD (entero 0 a 10, "
    "0 = muy improbable, 10 = certeza casi absoluta) de que la tesis se materialice, calibrada "
    "según la evidencia, con una justificación breve. Sé exigente: reserva >85 para líderes "
    "claros y reserva probabilidades >=8 solo para tendencias con evidencia muy sólida. "
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
        '    "overall_score": 0-100,\n'
        '    "thesis": "2-3 frases: por qué (o por qué no) es una buena forma de jugar esta tendencia",\n'
        '    "key_risks": "1-2 riesgos cualitativos clave"\n'
        "  }]\n"
        "}\n"
        "Incluye TODAS las empresas de la lista, usando exactamente su mismo TICKER."
    )
    raw = await _llm(*SYNTHESIZER_MODEL, f"thesis-syn-trend-{datetime.now(timezone.utc).timestamp()}",
                     SYNTHESIZER_TREND_SYS, user)
    return _extract_json(raw)


# ---------------------- Flow B: Company → trends ----------------------

INVESTIGATOR_COMPANY_SYS = (
    "Eres un analista de equity research senior. Recibes resultados REALES de búsqueda web "
    "reciente sobre una empresa cotizada. Identificas las MEGATENDENCIAS / temas estructurales "
    "en los que la empresa encaja y su rol dentro de la cadena de valor de cada una. "
    "Confirma el TICKER bursátil canónico exacto de la empresa (formato Yahoo Finance). "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido, sin texto adicional."
)


async def run_company_thesis(company: str, sources: list) -> dict:
    sources_block = _sources_block(sources)
    inv_user = (
        f"EMPRESA A ANALIZAR (nombre o ticker): {company}\n\n"
        f"RESULTADOS DE BÚSQUEDA WEB RECIENTES:\n{sources_block}\n\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "company": {"name": "Nombre oficial", "ticker": "TICKER"},\n'
        '  "summary": "2-3 frases sobre el negocio y su posicionamiento",\n'
        '  "trends": [{"name": "megatendencia", "fit_description": "cómo encaja la empresa", "value_chain_role": "su rol en esa cadena"}]\n'
        "}\n"
        "Incluye entre 3 y 6 tendencias estructurales reales, ordenadas por relevancia para la empresa."
    )
    inv_raw = await _llm(*INVESTIGATOR_MODEL, f"thesis-inv-co-{datetime.now(timezone.utc).timestamp()}",
                         INVESTIGATOR_COMPANY_SYS, inv_user)
    inv = _extract_json(inv_raw)
    trends = inv.get("trends") or []
    if not trends:
        raise ValueError("El investigador no pudo identificar tendencias para esta empresa. Revisa el nombre o ticker.")

    comp = inv.get("company") or {}
    syn = await _synthesize_company_trends(comp.get("name") or company, trends)
    syn_trends = syn.get("trends") or []
    rel_by_name = {(t.get("name") or "").lower(): t for t in syn_trends}

    merged = []
    for idx, t in enumerate(trends):
        s = rel_by_name.get((t.get("name") or "").lower()) or (syn_trends[idx] if idx < len(syn_trends) else {})
        merged.append({
            "name": t.get("name"),
            "fit_description": t.get("fit_description"),
            "value_chain_role": t.get("value_chain_role"),
            "relevance_score": _clamp_score(s.get("relevance_score")),
            "rationale": s.get("rationale"),
        })
    merged.sort(key=lambda x: (x["relevance_score"] is None, -(x["relevance_score"] or 0)))

    return {
        "type": "company",
        "query": company,
        "company": {"name": comp.get("name") or company, "ticker": (comp.get("ticker") or "").upper().strip()},
        "title": comp.get("name") or company,
        "summary": inv.get("summary"),
        "probability": _clamp10(syn.get("overall_probability")),
        "probability_rationale": syn.get("overall_probability_rationale"),
        "trends": merged,
        "overall_relevance": _clamp_score(syn.get("overall_relevance")),
        "contra": None,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


SYNTHESIZER_COMPANY_SYS = (
    "Eres un estratega de inversión. Recibes una empresa y una lista de megatendencias en las "
    "que encaja. Asignas a cada tendencia un score de RELEVANCIA de 0 a 100 (cuánto pesa esa "
    "tendencia en la tesis de la empresa) con una justificación breve, y un score global de "
    "relevancia temática. También estimas la PROBABILIDAD (entero 0 a 10) de que la tesis "
    "alcista temática de la empresa se materialice, con una justificación breve. "
    "Responde SIEMPRE en español y SOLO con un objeto JSON válido."
)


async def _synthesize_company_trends(company: str, trends: list) -> dict:
    lst = "\n".join(f"- {t.get('name')}: {t.get('fit_description')}" for t in trends)
    user = (
        f"EMPRESA: {company}\n\nTENDENCIAS:\n{lst}\n\n"
        "Devuelve un JSON con esta forma EXACTA:\n"
        "{\n"
        '  "overall_relevance": 0-100,\n'
        '  "overall_probability": 0-10,\n'
        '  "overall_probability_rationale": "1-2 frases justificando la probabilidad de la tesis temática",\n'
        '  "trends": [{"name": "misma tendencia", "relevance_score": 0-100, "rationale": "1-2 frases"}]\n'
        "}\n"
        "Incluye TODAS las tendencias con su mismo nombre."
    )
    raw = await _llm(*SYNTHESIZER_MODEL, f"thesis-syn-co-{datetime.now(timezone.utc).timestamp()}",
                     SYNTHESIZER_COMPANY_SYS, user)
    return _extract_json(raw)


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
    raw = await _llm(*SYNTHESIZER_MODEL, f"thesis-contra-syn-{datetime.now(timezone.utc).timestamp()}",
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
    inv_raw = await _llm(*INVESTIGATOR_MODEL, f"thesis-contra-inv-trend-{datetime.now(timezone.utc).timestamp()}",
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
    inv_raw = await _llm(*INVESTIGATOR_MODEL, f"thesis-contra-inv-co-{datetime.now(timezone.utc).timestamp()}",
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

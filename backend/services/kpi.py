"""KPI validation module.

For a company that already has a DEVELOPED thesis, this extracts the company's
GRANULAR OPERATIONAL KPIs (ARR, NRR, customers, backlog/RPO, bookings, churn,
subscribers/ARPU, book-to-bill, …) from its latest earnings/IR via live web
search + LLM, and judges whether each KPI is VALIDATING or REFUTING the thesis.

A deterministic coefficient C = 1 + α·S (α=0.5) is computed in the backend from
the per-KPI signal s∈[-1,1] and weight w∈[0,1] the judge returns, so the number
is transparent and reproducible (and recomputable after a manual edit):
  - C per driver (each developed thesis = a growth driver)
  - C global for the company (relevance-weighted over all KPIs)
C > 1 → thesis being validated;  C < 1 → deteriorating.

Models (independent of the global thesis preset, per product decision):
  - Extractor: Gemini Flash (cheap)
  - Judge:     Claude Sonnet (quality)
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone

from services.thesis import _llm, _run_searches, _extract_json, _sources_block

logger = logging.getLogger(__name__)

ALPHA = 0.5  # coefficient sensitivity: C ∈ [1-α, 1+α] = [0.5, 1.5]
KPI_EXTRACTOR_MODEL = ("gemini", "gemini-2.5-flash")
KPI_JUDGE_MODEL = ("anthropic", "claude-sonnet-4-5-20250929")


def gather_kpi_sources(company_name: str, ticker: str, max_results: int = 6) -> list:
    """Live web search focused on the company's LATEST operational KPIs."""
    name = (company_name or ticker or "").strip()
    year = datetime.now(timezone.utc).year
    queries = [
        f"{name} latest quarterly earnings results {year} ARR net revenue retention customers",
        f"{name} {ticker} Q earnings call key metrics backlog RPO bookings guidance {year}",
        f"{name} investor relations operating metrics subscribers ARPU churn {year}",
        f"{name} {ticker} earnings press release KPIs growth {year}",
    ]
    return _run_searches(queries, max_results=max_results, cap=20)


def _norm(s: str) -> str:
    return (s or "").strip().lower()


# ---------------------- LLM prompts ----------------------

EXTRACTOR_SYS = """Eres un analista financiero experto en extraer KPIs OPERATIVOS (no los financieros GAAP estándar) de los últimos resultados/comunicados de inversores de una empresa.

A partir de los RESULTADOS DE BÚSQUEDA en vivo y de la lista de DRIVERS DE CRECIMIENTO (tesis) de la empresa, extrae los KPIs operativos relevantes para ESTE tipo de empresa y que se relacionen con esos drivers. Ejemplos según el negocio:
- SaaS/software: ARR, NRR/Net Revenue Retention (DBNRR), nº de clientes, clientes >100k ARR, RPO/backlog, bookings, churn.
- Industrial/defensa: backlog, book-to-bill, pedidos (orders).
- Consumo/streaming/gaming: suscriptores/usuarios de pago, DAU/MAU, bookings, ARPU/ARPDAU, horas de uso.
- Otros: el KPI operativo que la empresa destaque.

REGLAS:
- Incluye SOLO KPIs que puedas respaldar con las fuentes (con su cita). Si no hay dato, NO lo inventes.
- Da el valor actual y el del periodo comparable anterior (si está disponible) para ver el momentum.
- Asigna cada KPI al driver más relacionado (usa EXACTAMENTE uno de los nombres de driver dados; si es transversal a la empresa, usa "general").
- `higher_is_better`: true si que el KPI suba es bueno (ARR, clientes, backlog, NRR), false si bajar es bueno (churn).
- 4 a 10 KPIs como máximo.

Devuelve SOLO JSON:
{
  "period": "p.ej. Q3 FY2025",
  "kpis": [
    {
      "name": "Net Revenue Retention",
      "value_current": "110%",
      "value_prior": "115%",
      "period_current": "Q3'25",
      "period_prior": "Q3'24",
      "unit": "%",
      "yoy_change": "-5pp",
      "higher_is_better": true,
      "driver": "<nombre exacto del driver o 'general'>",
      "source_url": "https://...",
      "source_quote": "frase textual de la fuente",
      "confidence": 0.0
    }
  ]
}"""

JUDGE_SYS = """Eres un analista de inversión. Tu tarea: juzgar si la TESIS de una empresa se está VALIDANDO o REFUTANDO según sus últimos KPIs operativos.

Para CADA KPI asigna:
- `signal` ∈ [-1, 1]: cuánto APOYA (+) o CONTRADICE (−) el driver/tesis AHORA, teniendo en cuenta dirección y momentum (p. ej. NRR 110% pero bajando = ligeramente negativo; backlog creciendo con fuerza = muy positivo; churn subiendo = negativo).
- `weight` ∈ [0, 1]: relevancia de ese KPI para el driver/tesis (un KPI central pesa ~0.9; uno accesorio ~0.3).
- `rationale`: una frase BREVE en español justificando la señal.

Y para CADA driver, un `verdict`: una frase breve en español (¿se valida o se deteriora y por qué?).

Devuelve SOLO JSON, repitiendo name+driver de cada KPI para poder alinear:
{
  "kpis": [ { "name": "...", "driver": "...", "signal": 0.6, "weight": 0.9, "rationale": "..." } ],
  "drivers": [ { "name": "...", "verdict": "..." } ]
}"""


def _drivers_block(drivers: list) -> str:
    lines = []
    for d in drivers:
        tam = d.get("tam_busd")
        lines.append(f"- {d.get('name')}"
                     + (f" [{d.get('type')}]" if d.get("type") else "")
                     + (f" · TAM ~${tam}B" if tam else "")
                     + (f"\n    Motor de demanda: {d.get('demand_driver')}" if d.get("demand_driver") else "")
                     + (f"\n    Encaje: {d.get('fit_description')}" if d.get("fit_description") else ""))
    return "\n".join(lines) if lines else "(sin drivers)"


async def _extract_kpis(company: str, drivers: list, sources_block: str) -> dict:
    names = ", ".join(d.get("name") for d in drivers if d.get("name")) or "general"
    user = (f"EMPRESA: {company}\n\nDRIVERS DE CRECIMIENTO (tesis) — usa estos nombres exactos al asignar `driver`:\n"
            f"{_drivers_block(drivers)}\n\nNombres válidos de driver: {names}, general\n\n"
            f"RESULTADOS DE BÚSQUEDA EN VIVO:\n{sources_block}\n\nExtrae los KPIs operativos en JSON.")
    raw = await _llm(*KPI_EXTRACTOR_MODEL, f"kpi-extract-{datetime.now(timezone.utc).timestamp()}",
                     EXTRACTOR_SYS, user)
    data = _extract_json(raw)
    return data if isinstance(data, dict) else {}


def _news_block(news: list) -> str:
    if not news:
        return ""
    lines = []
    for n in news[:15]:
        d = n.get("published_at") or ""
        lines.append(f"- ({d}) [{n.get('sentiment') or 'neutral'}] {n.get('headline')}"
                     + (f" — {n.get('why_it_matters')}" if n.get("why_it_matters") else
                        (f" — {n.get('summary')}" if n.get("summary") else "")))
    return "\n".join(lines)


async def _judge_kpis(company: str, drivers: list, kpis: list, context_news: list = None) -> dict:
    kpi_lines = []
    for k in kpis:
        kpi_lines.append(
            f"- {k.get('name')} (driver: {k.get('driver') or 'general'}) · "
            f"actual {k.get('value_current')} vs anterior {k.get('value_prior')} · "
            f"sube_es_bueno={k.get('higher_is_better')}")
    news_ctx = ""
    nb = _news_block(context_news or [])
    if nb:
        news_ctx = ("\n\nNOTICIAS RECIENTES (contexto cualitativo — úsalas SOLO para matizar señal/peso y "
                    "verdict; el dato cuantitativo del KPI manda):\n" + nb)
    user = (f"EMPRESA: {company}\n\nDRIVERS (tesis):\n{_drivers_block(drivers)}\n\n"
            f"KPIs EXTRAÍDOS:\n" + "\n".join(kpi_lines) + news_ctx +
            "\n\nJuzga señal y peso por KPI + verdict por driver, en JSON.")
    raw = await _llm(*KPI_JUDGE_MODEL, f"kpi-judge-{datetime.now(timezone.utc).timestamp()}",
                     JUDGE_SYS, user)
    data = _extract_json(raw)
    return data if isinstance(data, dict) else {}


# ---------------------- Deterministic coefficient ----------------------

def _clampf(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, v))


def compute_kpi_coefficients(kpis: list, driver_names: list, alpha: float = ALPHA) -> dict:
    """Pure: from each KPI's signal s∈[-1,1] and weight w∈[0,1], compute the
    relevance-weighted signal S and the coefficient C = 1 + α·S, per driver and
    globally. Reused on manual edit so the number stays transparent/reproducible."""
    norm = []
    for k in kpis:
        s = _clampf(k.get("signal"), -1, 1)
        w = _clampf(k.get("weight"), 0, 1)
        nk = dict(k)
        nk["signal"] = 0.0 if s is None else s
        nk["weight"] = 0.0 if w is None else w
        norm.append(nk)

    def agg(items):
        tw = sum(i["weight"] for i in items)
        if tw <= 0:
            return None, None
        S = sum(i["weight"] * i["signal"] for i in items) / tw
        return round(S, 3), round(1 + alpha * S, 2)

    drivers_out = []
    for dn in driver_names:
        items = [i for i in norm if _norm(i.get("driver")) == _norm(dn)]
        S, C = agg(items)
        drivers_out.append({"name": dn, "n_kpis": len(items), "signal": S, "coef": C})

    Sg, Cg = agg(norm)
    return {
        "alpha": alpha,
        "kpis": norm,
        "drivers": drivers_out,
        "signal_global": Sg,
        "coef_global": Cg,
    }


# ---------------------- Pipeline ----------------------

def _merge_judge(kpis: list, judged: dict) -> list:
    """Attach signal/weight/rationale from the judge onto the extracted KPIs
    (match by name+driver, fallback positional)."""
    jk = (judged or {}).get("kpis") or []
    by_key = {}
    for j in jk:
        by_key[(_norm(j.get("name")), _norm(j.get("driver")))] = j
    out = []
    for i, k in enumerate(kpis):
        j = by_key.get((_norm(k.get("name")), _norm(k.get("driver"))))
        if j is None and i < len(jk):
            j = jk[i]  # positional fallback
        k = dict(k)
        if j:
            k["signal"] = j.get("signal")
            k["weight"] = j.get("weight")
            k["rationale"] = j.get("rationale")
        else:
            k.setdefault("signal", 0.0)
            k.setdefault("weight", 0.0)
        out.append(k)
    return out


async def run_company_kpis(company: str, ticker: str, drivers: list, sources: list, context_news: list = None) -> dict:
    """Full KPI pipeline: extract (Gemini) → judge (Claude, with optional news
    context) → coefficients (pure)."""
    sblock = _sources_block(sources)
    ext = await _extract_kpis(company, drivers, sblock)
    kpis = ext.get("kpis") or []
    period = ext.get("period")
    driver_names = [d.get("name") for d in drivers if d.get("name")]

    if not kpis:
        return {
            "period": period, "kpis": [], "drivers": [{"name": n, "n_kpis": 0, "signal": None, "coef": None, "verdict": None} for n in driver_names],
            "coef_global": None, "signal_global": None, "alpha": ALPHA,
            "sources": [{"title": s.get("title"), "url": s.get("url")} for s in sources][:12],
            "note": "No se encontraron KPIs operativos fiables en las fuentes recientes.",
        }

    judged = await _judge_kpis(company, drivers, kpis, context_news)
    kpis = _merge_judge(kpis, judged)
    coeff = compute_kpi_coefficients(kpis, driver_names, ALPHA)

    # Attach the per-driver verdict text from the judge
    verdicts = {_norm(d.get("name")): d.get("verdict") for d in (judged.get("drivers") or [])}
    for d in coeff["drivers"]:
        d["verdict"] = verdicts.get(_norm(d.get("name")))

    coeff["period"] = period
    coeff["sources"] = [{"title": s.get("title"), "url": s.get("url")} for s in sources][:12]
    return coeff


# ---------------------- Document pre-extraction (Gemini Flash, multimodal) ----------------------

DOC_EXTRACT_SYS = """Eres un analista financiero. Vas a leer un documento (presentación de inversores, informe, o imagen de un gráfico) de una empresa y debes EXTRAER de forma fiel toda la información OPERATIVA y de KPIs que contenga: ARR, NRR/net revenue retention, nº de clientes/suscriptores, backlog/RPO, bookings, book-to-bill, churn, ARPU, DAU/MAU, ingresos por segmento/geografía, guidance, y cualquier métrica con su VALOR y PERIODO.

FORMATO DE RESPUESTA (obligatorio):
- La PRIMERA línea debe ser exactamente: `TÍTULO: <nombre corto y descriptivo del documento>` incluyendo el TIPO y el PERIODO o TEMA. Ejemplos: "Presentación resultados Q1 2026", "Gráfico TTM suscriptores desde 2021", "Informe anual 2025", "Carta a accionistas Q4 2025".
- A partir de la segunda línea, el RESUMEN de KPIs (bullets).

REGLAS:
- Transcribe los NÚMEROS EXACTOS tal como aparecen, con su unidad y periodo (p. ej. "Suscriptores de pago: 12,2M (Q4 2025) vs 10,9M (Q4 2024)").
- Si es un GRÁFICO, lee los valores de los ejes/etiquetas lo mejor posible e indica que provienen de un gráfico.
- NO inventes datos que no estén en el documento. Si algo es ilegible, dilo.
- Resumen claro en texto plano, centrado SOLO en métricas operativas y cifras. Conciso pero completo."""


async def extract_document_text(file_path: str, mime_type: str, company: str, filename: str = "") -> str:
    """One-time pre-extraction of a PDF/image into a compact operational-KPI digest
    (Gemini Flash multimodal). Stored on the file record and reused as a cheap text
    source in later KPI analyses (so we don't re-pay vision cost each run)."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    api_key = os.environ["EMERGENT_LLM_KEY"]
    chat = LlmChat(api_key=api_key, session_id=f"kpi-doc-{datetime.now(timezone.utc).timestamp()}",
                   system_message=DOC_EXTRACT_SYS).with_model(*KPI_EXTRACTOR_MODEL)
    fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
    prompt = (f"EMPRESA: {company}\nDOCUMENTO: {filename}\n\n"
              "Extrae todas las métricas operativas y KPIs con sus cifras y periodos.")
    resp = await chat.send_message(UserMessage(text=prompt, file_contents=[fc]))
    return (resp or "").strip()


# ---------------------- Targeted single-KPI search ----------------------

SEARCH_EXTRACTOR_SYS = """Eres un analista financiero. El usuario quiere un DATO/KPI operativo CONCRETO de una empresa (p. ej. "número de suscriptores", "ARR", "backlog").

A partir de los RESULTADOS DE BÚSQUEDA en vivo, extrae el/los KPI(s) que responden a su PETICIÓN.
REGLAS:
- SOLO datos respaldados por las fuentes, con su cita. Si NO encuentras el dato, devuelve `kpis` vacío y explica en `note`.
- Da valor actual y, si está disponible, el del periodo anterior (para ver momentum).
- Asigna cada KPI al driver más relacionado (usa EXACTAMENTE uno de los nombres de driver dados, o "general").
- `higher_is_better`: true si que suba es bueno (suscriptores, ARR, backlog), false si bajar es bueno (churn).
- 1 a 3 KPIs como máximo (los que respondan a la petición).

Devuelve SOLO JSON:
{
  "kpis": [
    { "name": "...", "value_current": "...", "value_prior": "...", "period_current": "...", "period_prior": "...",
      "unit": "...", "yoy_change": "...", "higher_is_better": true, "driver": "<driver o 'general'>",
      "source_url": "https://...", "source_quote": "...", "confidence": 0.0 }
  ],
  "note": "vacío si todo OK, o por qué no se encontró"
}"""


def gather_kpi_search_sources(company: str, ticker: str, query: str, max_results: int = 6) -> list:
    name = (company or ticker or "").strip()
    year = datetime.now(timezone.utc).year
    queries = [
        f"{name} {query} {year}",
        f"{name} {ticker} {query} latest earnings results {year}",
        f"{name} {query} investor relations",
    ]
    return _run_searches(queries, max_results=max_results, cap=18)


async def run_kpi_search(company: str, ticker: str, drivers: list, query: str, sources: list) -> dict:
    """Targeted: extract the SPECIFIC KPI the user asked for, then judge it in the
    thesis context (signal/weight/rationale). Returns the new KPI(s) to merge."""
    sblock = _sources_block(sources)
    names = ", ".join(d.get("name") for d in drivers if d.get("name")) or "general"
    user = (f"EMPRESA: {company}\nPETICIÓN DEL USUARIO: {query}\n\n"
            f"DRIVERS DE CRECIMIENTO (usa estos nombres exactos al asignar `driver`):\n{_drivers_block(drivers)}\n"
            f"Nombres válidos de driver: {names}, general\n\n"
            f"RESULTADOS DE BÚSQUEDA EN VIVO:\n{sblock}\n\nExtrae el/los KPI(s) pedido(s) en JSON.")
    raw = await _llm(*KPI_EXTRACTOR_MODEL, f"kpi-search-{datetime.now(timezone.utc).timestamp()}",
                     SEARCH_EXTRACTOR_SYS, user)
    data = _extract_json(raw) or {}
    kpis = data.get("kpis") or []
    if not kpis:
        return {"kpis": [], "note": data.get("note") or "No se encontró el dato en las fuentes recientes.", "judged_drivers": []}
    judged = await _judge_kpis(company, drivers, kpis)
    kpis = _merge_judge(kpis, judged)
    return {"kpis": kpis, "note": None, "judged_drivers": judged.get("drivers") or []}


# ---------------------- Qualitative news (inform scores; aged out over time) ----------------------

NEWS_HALF_LIFE_DAYS = 45
NEWS_MAX_ITEMS = 15
NEWS_MIN_EFF = 0.04  # below this effective relevance a news item is "forgotten"

NEWS_EXTRACTOR_SYS = """Eres un analista de equity research. A partir de RESULTADOS DE BÚSQUEDA en vivo, extrae las NOTICIAS materiales y recientes sobre una empresa que puedan afectar a su tesis (cualitativamente): resultados, regulación, demandas, alianzas, lanzamientos, guidance, dirección, competencia.

REGLAS:
- SOLO noticias reales respaldadas por las fuentes, con su enlace. NO inventes titulares ni fechas.
- `published_at`: fecha real (YYYY-MM-DD); si no la sabes con seguridad, déjala vacía.
- `sentiment`: "positivo" | "negativo" | "neutral" para la tesis.
- `relevance`: 0..1 (cuán material es para la tesis de la empresa).
- `driver`: el driver más relacionado (uno de los dados) o "general".
- Máximo 8 noticias, las más relevantes y recientes.

Devuelve SOLO JSON:
{ "news": [ { "headline": "...", "summary": "1-2 frases", "why_it_matters": "impacto en la tesis",
  "published_at": "YYYY-MM-DD", "sentiment": "positivo|negativo|neutral", "relevance": 0.0,
  "driver": "<driver o general>", "url": "https://..." } ] }"""


def gather_news_sources(company: str, ticker: str, max_results: int = 5) -> list:
    name = (company or ticker or "").strip()
    year = datetime.now(timezone.utc).year
    queries = [
        f"{name} {ticker} news {year}",
        f"{name} earnings regulation lawsuit partnership guidance {year}",
        f"{name} {ticker} latest developments {year}",
    ]
    return _run_searches(queries, max_results=max_results, cap=18)


def gather_news_search_sources(company: str, ticker: str, query: str, max_results: int = 6) -> list:
    name = (company or ticker or "").strip()
    year = datetime.now(timezone.utc).year
    queries = [f"{name} {query} {year}", f"{name} {ticker} {query} news {year}", f"{query} {name}"]
    return _run_searches(queries, max_results=max_results, cap=18)


async def run_company_news(company: str, ticker: str, drivers: list, sources: list) -> list:
    """Extract material news items (Gemini Flash) from search results."""
    names = ", ".join(d.get("name") for d in drivers if d.get("name")) or "general"
    user = (f"EMPRESA: {company} ({ticker})\n\nDRIVERS (para asignar `driver`): {names}, general\n\n"
            f"RESULTADOS DE BÚSQUEDA EN VIVO:\n{_sources_block(sources)}\n\nExtrae las noticias materiales en JSON.")
    raw = await _llm(*KPI_EXTRACTOR_MODEL, f"kpi-news-{datetime.now(timezone.utc).timestamp()}",
                     NEWS_EXTRACTOR_SYS, user)
    data = _extract_json(raw) or {}
    out = []
    for n in (data.get("news") or [])[:10]:
        if not (n.get("headline") or "").strip():
            continue
        rel = _clampf(n.get("relevance"), 0, 1)
        out.append({
            "headline": (n.get("headline") or "").strip(),
            "summary": (n.get("summary") or "").strip(),
            "why_it_matters": (n.get("why_it_matters") or "").strip(),
            "published_at": (n.get("published_at") or "").strip(),
            "sentiment": (n.get("sentiment") or "neutral").strip().lower(),
            "relevance": 0.6 if rel is None else rel,
            "driver": (n.get("driver") or "general").strip(),
            "url": (n.get("url") or "").strip(),
        })
    return out


def _age_days(item: dict, now: datetime) -> float:
    raw = item.get("published_at") or item.get("created_at") or ""
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            dt = datetime.strptime(raw[:26] if "T" in raw else raw[:10], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(0.0, (now - dt).total_seconds() / 86400.0)
        except (ValueError, TypeError):
            continue
    # Unknown date → treat as moderately old so it ages out unless re-found.
    return 21.0


def news_effective_relevance(item: dict, now: datetime = None) -> float:
    now = now or datetime.now(timezone.utc)
    rel = _clampf(item.get("relevance"), 0, 1)
    rel = 0.6 if rel is None else rel
    decay = 0.5 ** (_age_days(item, now) / NEWS_HALF_LIFE_DAYS)
    return round(rel * decay, 4)


def prune_news(items: list, now: datetime = None) -> tuple:
    """Apply 45-day half-life decay; keep the top NEWS_MAX_ITEMS above NEWS_MIN_EFF.
    Returns (kept, dropped) — `dropped` are 'forgotten' (older/less relevant)."""
    now = now or datetime.now(timezone.utc)
    scored = []
    for it in items:
        eff = news_effective_relevance(it, now)
        scored.append((eff, it))
    scored.sort(key=lambda x: -x[0])
    kept, dropped = [], []
    for i, (eff, it) in enumerate(scored):
        it = dict(it)
        it["effective_relevance"] = eff
        if i < NEWS_MAX_ITEMS and eff >= NEWS_MIN_EFF:
            kept.append(it)
        else:
            dropped.append(it)
    return kept, dropped


def news_dedupe_key(headline: str, url: str = None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (headline or "").lower()).strip()[:80]


async def merge_prune_news(db, company_id, user_id, ticker, new_items, origin):
    """Upsert news into `kpi_news` (dedupe by normalized headline), then apply the
    45-day decay/cap so old, low-relevance items are 'forgotten'. Shared by the KPI
    analysis, the news button, and the weekly Radar. Returns the kept list."""
    now = datetime.now(timezone.utc)
    nowiso = now.isoformat()
    for n in (new_items or []):
        h = (n.get("headline") or "").strip()
        if not h:
            continue
        key = news_dedupe_key(h, n.get("url"))
        ex = await db.kpi_news.find_one(
            {"company_id": company_id, "user_id": user_id, "dedupe_key": key, "is_deleted": False},
            {"_id": 0, "id": 1})
        if ex:
            await db.kpi_news.update_one({"id": ex["id"]}, {"$set": {
                "last_seen": nowiso,
                "relevance": max(n.get("relevance") or 0.6, 0.0),
                "published_at": n.get("published_at") or "",
            }})
            continue
        await db.kpi_news.insert_one({
            "id": uuid.uuid4().hex, "user_id": user_id, "company_id": company_id, "ticker": ticker,
            "headline": h, "summary": n.get("summary"), "why_it_matters": n.get("why_it_matters"),
            "url": n.get("url"), "published_at": n.get("published_at") or "",
            "sentiment": n.get("sentiment") or "neutral",
            "relevance": n.get("relevance") if n.get("relevance") is not None else 0.6,
            "driver": n.get("driver") or "general", "origin": origin, "dedupe_key": key,
            "is_deleted": False, "created_at": nowiso, "last_seen": nowiso,
        })
    alln = await db.kpi_news.find(
        {"company_id": company_id, "user_id": user_id, "is_deleted": False}, {"_id": 0}).to_list(length=200)
    kept, dropped = prune_news(alln, now)
    for d in dropped:
        if d.get("id"):
            await db.kpi_news.update_one({"id": d["id"]}, {"$set": {"is_deleted": True}})
    return kept

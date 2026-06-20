"""SEC EDGAR fallback for KPI analysis.

When no investor-deck PDF is found, US-listed companies still file the substance
of their results with the SEC. This grabs the latest 10-Q / 10-K (free public
EDGAR API, no key) so the KPI extractor reads the official operating metrics.
Only works for US filers (skips foreign tickers like SAP.DE / SAN.MC).
"""
import re
import logging
import httpx
from services.fetcher import _clean_html

logger = logging.getLogger(__name__)

# SEC requires a descriptive User-Agent with contact info; they rate-limit anonymous bots.
SEC_HEADERS = {"User-Agent": "Valuation Studio research@valuation-studio.app",
               "Accept-Encoding": "gzip, deflate"}
_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
_TIMEOUT = 12.0
_cik_cache = {}

_MD_MARKERS = (
    "results of operations", "management's discussion", "management’s discussion",
    "key business metrics", "key operating metrics", "operating metrics", "key metrics",
)


def _resolve_cik(ticker: str):
    t = (ticker or "").upper().strip()
    if not t or "." in t:
        return None  # foreign listing → not on EDGAR
    if not _cik_cache:
        try:
            with httpx.Client(timeout=_TIMEOUT, headers=SEC_HEADERS) as c:
                data = c.get(_TICKERS_URL).json()
            for row in data.values():
                _cik_cache[str(row["ticker"]).upper()] = str(row["cik_str"]).zfill(10)
        except Exception as e:
            logger.warning(f"SEC ticker map failed: {e}")
            return None
    return _cik_cache.get(t)


def _relevant_slice(text: str, max_chars: int = 40000) -> str:
    """Start the stored text at the BODY MD&A / Results-of-Operations section (where
    the operating metrics live), skipping the table-of-contents mention, so the first
    chunk the extractor reads is the useful part."""
    low = text.lower()
    n = len(text)
    cands = []
    for m in ("management's discussion and analysis", "management’s discussion and analysis",
              "results of operations", "key business metrics", "key operating metrics"):
        i = low.rfind(m)  # last occurrence = the real section, not the TOC entry
        if i > 0 and n - i >= 6000:
            cands.append(i)
    start = min(cands) if cands else 0
    return text[start:start + max_chars]


def fetch_latest_sec_report(ticker: str, forms=("10-Q", "10-K")):
    """Return {url, filename, html, text, form, date} for the most recent 10-Q/10-K,
    or None (non-US, not found, or fetch error)."""
    cik = _resolve_cik(ticker)
    if not cik:
        return None
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=SEC_HEADERS, follow_redirects=True) as c:
            sub = c.get(f"https://data.sec.gov/submissions/CIK{cik}.json").json()
            recent = (sub.get("filings") or {}).get("recent") or {}
            form_list = recent.get("form", [])
            accs = recent.get("accessionNumber", [])
            docs = recent.get("primaryDocument", [])
            dates = recent.get("filingDate", [])
            idx = next((i for i, f in enumerate(form_list) if f in forms), None)  # newest-first
            if idx is None:
                return None
            acc = accs[idx].replace("-", "")
            doc, form, date = docs[idx], form_list[idx], dates[idx]
            url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/{doc}"
            resp = c.get(url)
            if resp.status_code >= 400 or not resp.content:
                return None
            text = _clean_html(resp.text)
            if len(text) < 500:
                return None
            return {"url": url, "filename": doc, "html": resp.content,
                    "text": _relevant_slice(text), "form": form, "date": date}
    except Exception as e:
        logger.warning(f"SEC fetch failed {ticker}: {e}")
        return None

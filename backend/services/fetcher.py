"""Lightweight web content fetcher for KPI analysis (Option A).

Opens the top search-result pages and reads their FULL content (HTML → clean
text) and downloads PDFs (decks, press releases) so the KPI extractor sees the
real numbers instead of only the ~500-char search snippets.

Hard caps keep cost/latency bounded; PDFs are capped and de-duplicated upstream
(by source URL) so we never re-download the same document.
"""
import re
import time
import logging
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

FETCH_MAX_PAGES = 6            # HTML results to open and read fully
FETCH_MAX_PDFS = 3            # PDFs downloaded per analysis (decks/press releases)
FETCH_MAX_ATTEMPTS = 18       # total URLs to try before giving up
FETCH_PER_PAGE_CHARS = 6000   # chars kept per HTML page
FETCH_TOTAL_CHARS = 40000     # global text budget across pages
FETCH_PDF_MAX_BYTES = 25 * 1024 * 1024
_REQ_TIMEOUT = 9.0
_DEADLINE_SECS = 50.0
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ValuationStudio/1.0)"}

_GENERIC_TOKENS = {"inc", "corp", "corporation", "the", "ltd", "plc", "sa", "ag",
                   "co", "company", "holdings", "group", "nv", "se", "limited", "&"}


def _name_tokens(company: str):
    toks = re.findall(r"[a-z0-9]+", (company or "").lower())
    return [t for t in toks if len(t) >= 3 and t not in _GENERIC_TOKENS]


def _pdf_relevant(url, title, snippet, name_tokens, ticker):
    """A downloaded PDF must (1) clearly belong to the company — its ticker/name in the
    URL or TITLE, OR it sits on a strong investor-relations domain (covers decks with
    hashed filenames on IR CDNs like s2.q4cdn.com) — and (2) look like an INVESTOR
    document. The search is already scoped to the company, so an IR-domain hit is
    almost certainly this company's."""
    ur = url.lower()
    strong_ir = any(k in ur for k in ("ir.", "/investor", "investor.", "sec.gov", "q4cdn", "q4inc"))
    where = f"{url} {title}".lower()
    company_match = (ticker and len(ticker) >= 2 and ticker.lower() in where) or any(tok in where for tok in name_tokens)
    if not (company_match or strong_ir):
        return False
    hay = f"{url} {title} {snippet}".lower()
    doc_signal = any(k in hay for k in (
        "update", "result", "quarter", "earnings", "shareholder", "presentation",
        "annual report", "investor", "press release", "10-q", "10-k", "8-k",
        " fy2", " q1", " q2", " q3", " q4", "-q1", "-q2", "-q3", "-q4"))
    ir_domain = strong_ir or any(k in ur for k in ("/static-files/", "/financials"))
    return doc_signal or ir_domain


def _clean_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "svg", "form"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def _priority(r):
    """Order candidates so PDFs (official decks) and IR/earnings pages are tried
    FIRST — within the attempts budget the gold-mine documents win."""
    u = (r.get("url") or "").lower().split("?")[0]
    t = ((r.get("title") or "") + " " + (r.get("snippet") or "")).lower()
    if u.endswith(".pdf"):
        return 0
    if any(k in u for k in ("investor", "/ir", "ir.", "earnings", "results", "press-release", "/news")):
        return 1
    if any(k in t for k in ("earnings", "quarter", "results", "update", "shareholder", "deck")):
        return 2
    return 3


def fetch_full_sources(results, company="", ticker="", max_pages=FETCH_MAX_PAGES, max_pdfs=FETCH_MAX_PDFS):
    """Open the top results and enrich them with full content.

    Returns (enriched_sources, pdfs):
      - enriched_sources: same shape as input; for HTML results we managed to
        fetch, `snippet` is replaced by fuller page text (others keep snippet).
      - pdfs: list of {url, filename, data, mime} for up to `max_pdfs` PDFs that
        clearly belong to the company (relevance-checked).
    """
    enriched = [dict(r) for r in (results or [])]
    enriched.sort(key=_priority)
    name_tokens = _name_tokens(company)
    pdfs = []
    budget = FETCH_TOTAL_CHARS
    opened = 0
    attempts = 0
    deadline = time.monotonic() + _DEADLINE_SECS
    try:
        with httpx.Client(timeout=_REQ_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
            for r in enriched:
                if attempts >= FETCH_MAX_ATTEMPTS or time.monotonic() > deadline:
                    break
                if opened >= max_pages and len(pdfs) >= max_pdfs:
                    break
                url = (r.get("url") or "").strip()
                if not url.startswith("http"):
                    continue
                attempts += 1
                is_pdf_url = url.lower().split("?")[0].endswith(".pdf")
                if is_pdf_url and not _pdf_relevant(url, r.get("title") or "", r.get("snippet") or "", name_tokens, ticker):
                    continue  # PDF that doesn't clearly belong to this company → skip (no download)
                try:
                    resp = client.get(url)
                    if resp.status_code >= 400:
                        continue
                    ctype = (resp.headers.get("content-type") or "").lower()
                    if "application/pdf" in ctype or is_pdf_url:
                        relevant = is_pdf_url or _pdf_relevant(url, r.get("title") or "", r.get("snippet") or "", name_tokens, ticker)
                        if relevant and len(pdfs) < max_pdfs and 0 < len(resp.content) <= FETCH_PDF_MAX_BYTES:
                            fname = url.split("/")[-1].split("?")[0] or "documento.pdf"
                            if not fname.lower().endswith(".pdf"):
                                fname += ".pdf"
                            pdfs.append({"url": url, "filename": fname, "data": resp.content, "mime": "application/pdf"})
                        continue
                    if "html" not in ctype and "text" not in ctype:
                        continue
                    if opened >= max_pages or budget <= 0:
                        continue
                    text = _clean_html(resp.text)
                    if len(text) < 200:
                        continue
                    take = min(FETCH_PER_PAGE_CHARS, budget)
                    r["snippet"] = text[:take]
                    budget -= take
                    opened += 1
                except Exception as e:
                    logger.warning(f"fetch failed {url}: {e}")
                    continue
    except Exception as e:
        logger.warning(f"fetcher session failed: {e}")
    logger.info(f"fetch_full_sources: opened {opened} pages, {len(pdfs)} pdfs (attempts {attempts})")
    return enriched, pdfs

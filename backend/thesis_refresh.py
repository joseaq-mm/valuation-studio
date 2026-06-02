"""Weekly Thesis Refresh + News Watch.

Mirrors radar.py / screener.py. For every user that opted in
(`user.thesis_refresh.enabled`):

  1. LIGHT refresh (no LLM, cheap): re-fetch fundamentals for every ticker that
     appears in the user's saved trend theses → keeps prices / projections / TAM
     Scores current on the dashboard.
  2. NEWS WATCH (one cheap LLM classification): live web search over the user's
     trend titles; flag only MATERIAL developments.
  3. DEEPEN (bounded): for each flagged trend that maps to a saved thesis,
     regenerate that thesis IN PLACE (full pipeline) — capped per run to control
     cost. The qualitative content is only regenerated when news warrants it.
  4. EMAIL: send the user a notice summarising the material news (and what was
     refreshed).
"""
import os
import re
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List

import resend

from services.thesis import run_news_watch, gather_sources, run_trend_thesis
from services.valuation import fetch_fundamentals_sync

logger = logging.getLogger(__name__)

DEEPEN_CAP = 2  # max full trend regenerations per user per run (cost guard)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


# LLM-heavy calls are synchronous under the hood → run inside their own loop in
# a worker thread so the main event loop is never blocked.
def _news_watch_sync(titles: List[str]) -> dict:
    return asyncio.run(run_news_watch(titles))


def _trend_thesis_sync(title: str) -> dict:
    sources = gather_sources(title, "trend")
    return asyncio.run(run_trend_thesis(title, sources))


async def _send_email_resend(to_addr: str, subject: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    if not api_key:
        logger.error("RESEND_API_KEY not configured; skipping thesis-refresh email.")
        return False
    resend.api_key = api_key
    try:
        result = await asyncio.to_thread(resend.Emails.send, {
            "from": sender, "to": [to_addr], "subject": subject, "html": html,
        })
        logger.info(f"Thesis-refresh email sent to {to_addr}: {result.get('id')}")
        return True
    except Exception as e:
        logger.error(f"Resend thesis-refresh send failed for {to_addr}: {e}")
        return False


def _build_news_email_html(user_name: str, items: List[Dict[str, Any]], deepened: List[Dict[str, Any]]) -> str:
    deepened_titles = {d.get("title") for d in deepened}
    rows = []
    for it in items:
        refreshed = it.get("trend") in deepened_titles
        tag = ('<span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;'
               'background:#1E7D45;color:#fff;padding:1px 6px;margin-left:6px;">tesis actualizada</span>') if refreshed else ""
        tickers = it.get("tickers") or []
        tk_html = ""
        if tickers:
            tk_html = ('<div style="font-family:monospace;font-size:11px;color:#052049;margin-top:4px;">'
                       + " · ".join(tickers) + "</div>")
        rows.append(f"""
            <tr><td style="padding:12px;border-bottom:1px solid #00000010;vertical-align:top;">
                <div style="font-family:sans-serif;font-size:11px;color:#B32A22;text-transform:uppercase;letter-spacing:.1em;">{it.get('trend','')}{tag}</div>
                <div style="font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;margin-top:3px;">{it.get('headline','')}</div>
                <div style="font-family:sans-serif;font-size:12px;color:#222;margin-top:6px;line-height:1.45;">{it.get('summary','')}</div>
                <div style="font-family:sans-serif;font-size:12px;color:#4A4A4A;margin-top:4px;line-height:1.45;"><strong>Por qué importa:</strong> {it.get('why_it_matters','')}</div>
                {tk_html}
            </td></tr>""")
    rows_html = "".join(rows)
    greeting = f"Hola {user_name.split()[0]}," if user_name else "Hola,"
    n = len(items)
    return f"""
        <table width="100%" cellspacing="0" cellpadding="0" style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;">
            <tr><td style="padding:24px 16px 8px;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:28px;">Valuation Studio</div>
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4A4A4A;">Novedades en tus tendencias · semanal</div>
            </td></tr>
            <tr><td style="padding:8px 16px 16px;">
                <p style="margin:0 0 8px;font-size:14px;">{greeting} esta semana hemos detectado {n} desarrollo{'s' if n != 1 else ''} material{'es' if n != 1 else ''} en las tendencias que sigues. Las tesis y empresas afectadas se han refrescado automáticamente.</p>
            </td></tr>
            <tr><td>
                <table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{rows_html}</table>
            </td></tr>
            <tr><td style="padding:16px;font-size:11px;color:#4A4A4A;line-height:1.5;">
                Entra a la app para revisar las tesis actualizadas. Para dejar de recibir estas novedades, desactiva el "Refresco semanal" en la página de Tesis.
            </td></tr>
        </table>
    """


async def _light_refresh_fundamentals(db, tickers: List[str]) -> int:
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
            logger.warning(f"thesis-refresh fundamentals fetch failed ({tk}): {e}")
    return refreshed


async def run_thesis_refresh(db) -> Dict[str, Any]:
    summary = {"users": 0, "tickers_refreshed": 0, "news_items": 0,
               "theses_deepened": 0, "emails_sent": 0}
    cursor = db.users.find({"thesis_refresh.enabled": True}, {"_id": 0})
    users = [u async for u in cursor]
    summary["users"] = len(users)

    for user in users:
        uid = user.get("user_id")
        if not uid:
            continue
        trend_docs = await db.theses.find(
            {"user_id": uid, "type": "trend"},
            {"_id": 0, "id": 1, "title": 1, "companies": 1},
        ).to_list(length=500)
        if not trend_docs:
            continue

        # 1. Light refresh of every ticker in the saved trend theses.
        tickers = set()
        for d in trend_docs:
            for c in (d.get("companies") or []):
                tk = (c.get("ticker") or "").upper().strip()
                if tk:
                    tickers.add(tk)
        summary["tickers_refreshed"] += await _light_refresh_fundamentals(db, list(tickers))

        # 2. News watch (one cheap LLM classification).
        titles = [d.get("title") for d in trend_docs if d.get("title")]
        try:
            nw = await asyncio.to_thread(_news_watch_sync, titles)
        except Exception as e:
            logger.error(f"news-watch failed for {uid}: {e}")
            nw = {"important": []}
        important = nw.get("important") or []
        summary["news_items"] += len(important)

        # 3. Deepen flagged trends (bounded by DEEPEN_CAP).
        deepened = []
        for it in important:
            if len(deepened) >= DEEPEN_CAP:
                break
            nt = _norm(it.get("trend"))
            match = next((d for d in trend_docs if _norm(d.get("title")) == nt
                          or (len(nt) >= 6 and (nt in _norm(d.get("title")) or _norm(d.get("title")) in nt))), None)
            if not match:
                continue
            try:
                fresh = await asyncio.to_thread(_trend_thesis_sync, match["title"])
                await db.theses.update_one(
                    {"id": match["id"], "user_id": uid},
                    {"$set": {**fresh, "updated_at": datetime.now(timezone.utc).isoformat(), "last_news": it}},
                )
                deepened.append({"title": match["title"], "thesis_id": match["id"]})
            except Exception as e:
                logger.error(f"thesis-refresh deepen failed ({match.get('id')}): {e}")
        summary["theses_deepened"] += len(deepened)

        # 4. Email the user if there is material news.
        if important and user.get("email"):
            subject = f"Novedades en tus tendencias · {len(important)} desarrollo{'s' if len(important) != 1 else ''}"
            html = _build_news_email_html(user.get("name") or "", important, deepened)
            if await _send_email_resend(user["email"], subject, html):
                summary["emails_sent"] += 1

    logger.info(f"Thesis-refresh run summary: {summary}")
    return summary

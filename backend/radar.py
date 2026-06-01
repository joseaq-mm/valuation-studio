"""Weekly Trend Radar: runs the auto-discovery pipeline and emails subscribers
when NEW high-heat emerging trends appear since the last run.

Mirrors screener.py: a single async job that
  1. Runs the discovery pipeline (live web search + GPT-5.2) in a worker thread.
  2. Compares the detected trends with those already seen (db.radar_state).
  3. Emails every opted-in user (user.radar.enabled) the NEW high-heat trends.
  4. Stores the updated set of seen trends.
"""
import os
import re
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List
import resend

from services.thesis import run_discover

logger = logging.getLogger(__name__)

RADAR_HEAT_MIN = 7          # only alert on trends with strong momentum
RADAR_STATE_ID = "global"
SEEN_CAP = 200              # keep the seen-trends list bounded


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def _build_radar_email_html(user_name: str, trends: List[Dict[str, Any]]) -> str:
    rows = []
    for t in trends:
        heat = t.get("heat")
        color = "#B32A22" if (heat or 0) >= 8 else "#B8860B"
        rows.append(f"""
            <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #00000010;vertical-align:top;">
                    <div style="font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;">{t.get('name','')}</div>
                    <div style="font-family:sans-serif;font-size:11px;color:#4A4A4A;margin-top:2px;">{t.get('sector','') or ''}</div>
                    <div style="font-family:sans-serif;font-size:12px;color:#222;margin-top:6px;line-height:1.45;">{t.get('why_now','') or ''}</div>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #00000010;text-align:right;vertical-align:top;font-family:monospace;font-weight:700;color:{color};">
                    {heat if heat is not None else '—'}/10
                </td>
            </tr>""")
    rows_html = "".join(rows)
    greeting = f"Hola {user_name.split()[0]}," if user_name else "Hola,"
    n = len(trends)
    return f"""
        <table width="100%" cellspacing="0" cellpadding="0" style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;">
            <tr><td style="padding:24px 16px 8px;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:28px;">Valuation Studio</div>
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4A4A4A;">Radar de tendencias · semanal</div>
            </td></tr>
            <tr><td style="padding:8px 16px 16px;">
                <p style="margin:0 0 8px;font-size:14px;">{greeting} el radar ha detectado {n} tendencia{'s' if n != 1 else ''} emergente{'s' if n != 1 else ''} con fuerte momentum:</p>
            </td></tr>
            <tr><td>
                <table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{rows_html}</table>
            </td></tr>
            <tr><td style="padding:16px;font-size:11px;color:#4A4A4A;line-height:1.5;">
                Entra a la app y pulsa "Desarrollar tesis" para analizar cualquiera de ellas a fondo (cadena de valor, líderes vs. disruptores, TAM y probabilidad).
                Para dejar de recibir el radar, desactívalo en la página de Tesis.
            </td></tr>
        </table>
    """


async def _send_email_resend(to_addr: str, subject: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    if not api_key:
        logger.error("RESEND_API_KEY not configured; skipping radar email.")
        return False
    resend.api_key = api_key
    try:
        result = await asyncio.to_thread(resend.Emails.send, {
            "from": sender, "to": [to_addr], "subject": subject, "html": html,
        })
        logger.info(f"Radar email sent to {to_addr}: {result.get('id')}")
        return True
    except Exception as e:
        logger.error(f"Resend radar send failed for {to_addr}: {e}")
        return False


async def run_radar(db) -> Dict[str, Any]:
    summary = {"candidates": 0, "new_trends": 0, "subscribers": 0, "emails_sent": 0}

    # 1. Discovery (blocking pipeline → run in a worker thread).
    try:
        result = await asyncio.to_thread(lambda: asyncio.run(run_discover()))
    except Exception as e:
        logger.error(f"radar discovery failed: {e}")
        return {**summary, "error": str(e)}
    candidates = result.get("candidates", [])
    summary["candidates"] = len(candidates)

    # 2. New high-heat trends vs. previously seen.
    state = await db.radar_state.find_one({"id": RADAR_STATE_ID}, {"_id": 0}) or {}
    seen = set(state.get("seen", []))
    new_trends = [c for c in candidates if (c.get("heat") or 0) >= RADAR_HEAT_MIN and _norm(c.get("name")) not in seen]
    summary["new_trends"] = len(new_trends)

    # 3. Email opted-in users.
    if new_trends:
        cursor = db.users.find({"radar.enabled": True}, {"_id": 0})
        users = [u async for u in cursor]
        summary["subscribers"] = len(users)
        for user in users:
            email = user.get("email")
            if not email:
                continue
            subject = f"Radar · {len(new_trends)} tendencia{'s' if len(new_trends) != 1 else ''} emergente{'s' if len(new_trends) != 1 else ''}"
            html = _build_radar_email_html(user.get("name") or "", new_trends)
            if await _send_email_resend(email, subject, html):
                summary["emails_sent"] += 1

    # 4. Persist the updated seen set (cap size).
    updated_seen = list(seen | {_norm(c.get("name")) for c in candidates})[-SEEN_CAP:]
    await db.radar_state.update_one(
        {"id": RADAR_STATE_ID},
        {"$set": {
            "id": RADAR_STATE_ID,
            "seen": updated_seen,
            "last_candidates": candidates,
            "last_run": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    logger.info(f"Radar run summary: {summary}")
    return summary

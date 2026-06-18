"""Weekly Trend Radar: now a TWO-section email per opted-in user.

  Section 1 — NEW emerging trends (existing): global discovery pipeline detects
  high-heat trends and reports the ones unseen since the last run. Same for
  everyone (mailed only to opted-in subscribers).

  Section 2 — News on YOUR companies (new in Feb 2026): per user, lists material
  news affecting the companies that have a complete plan (the ones surfaced in
  /thesis treemap with their developed-from-plan tesis). Each row shows days
  since the plan was generated. Header banner reminds the user that if news is
  material OR the flow is older than 60 days, regenerating the company plan is
  the only way to refresh qualitative scores and TAM (the weekly fundamentals
  refresh covers ONLY the quantitative side).

To keep LLM cost bounded we batch the union of all subscribers' companies into
a single news-watch call and dispatch only the relevant rows per email.
"""
import os
import re
import urllib.parse
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import resend

from services.thesis import run_discover, run_company_news_watch

logger = logging.getLogger(__name__)

RADAR_HEAT_MIN = 7          # only alert on trends with strong momentum
RADAR_STATE_ID = "global"
SEEN_CAP = 200              # keep the seen-trends list bounded
STALE_DAYS = 60             # banner highlights companies older than this


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def _days_since(iso_ts: Optional[str]) -> Optional[int]:
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        return None


async def collect_user_companies(db, user_id: str) -> List[Dict[str, Any]]:
    """User's COMPLETE company theses (the ones with at least one developed
    trend thesis born from this plan). Same definition as the treemap
    `complete_tickers` used by the dashboard endpoint. Returns:
        [{ticker, name, plan_id, plan_created_at, days_since, trend_count}]
    Newest plan per ticker wins (consistent with the dashboard logic)."""
    company_docs = await db.theses.find(
        {"user_id": user_id, "type": "company"},
        {"_id": 0, "id": 1, "company": 1, "split_dev": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(length=200)
    out: List[Dict[str, Any]] = []
    seen = set()
    for d in company_docs:
        tk = ((d.get("company") or {}).get("ticker") or "").upper().strip()
        if not tk or tk in seen:
            continue
        # "complete" = at least one developed driver (mirrors company_is_complete)
        sd = d.get("split_dev") or []
        dev_ids = [s.get("developed_id") for s in sd if s.get("developed_id")]
        if not dev_ids:
            continue
        seen.add(tk)
        out.append({
            "ticker": tk,
            "name": (d.get("company") or {}).get("name") or tk,
            "plan_id": d.get("id"),
            "plan_created_at": d.get("created_at"),
            "days_since": _days_since(d.get("created_at")),
            "trend_count": len(dev_ids),
        })
    return out


def _build_radar_email_html(user_name: str,
                            trends: List[Dict[str, Any]],
                            companies: List[Dict[str, Any]],
                            news_by_ticker: Dict[str, List[Dict[str, Any]]]) -> str:
    """Render the two-section radar email. `news_by_ticker` maps a ticker → list
    of important news items. Companies with no news are still listed (with their
    days-since age), so the user can spot stale plans even when nothing material
    has happened."""
    base_url = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
    greeting = f"Hola {user_name.split()[0]}," if user_name else "Hola,"
    nt = len(trends)
    has_companies = bool(companies)
    any_stale = any((c.get("days_since") or 0) >= STALE_DAYS for c in companies)
    any_news = bool(news_by_ticker)

    # ---------- Section 1: emerging trends ----------
    section_trends_html = ""
    if trends:
        rows = []
        for t in trends:
            heat = t.get("heat")
            color = "#B32A22" if (heat or 0) >= 8 else "#B8860B"
            name = t.get("name", "") or ""
            title_html = name
            if base_url and name:
                href = f"{base_url}/thesis?explore=" + urllib.parse.quote(name, safe="")
                title_html = (
                    f'<a href="{href}" '
                    f'style="color:#052049;text-decoration:none;border-bottom:1px solid #05204940;" '
                    f'target="_blank" rel="noopener">{name}</a>'
                )
            rows.append(f"""
                <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #00000010;vertical-align:top;">
                        <div style="font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;">{title_html}</div>
                        <div style="font-family:sans-serif;font-size:11px;color:#4A4A4A;margin-top:2px;">{t.get('sector','') or ''}</div>
                        <div style="font-family:sans-serif;font-size:12px;color:#222;margin-top:6px;line-height:1.45;">{t.get('why_now','') or ''}</div>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #00000010;text-align:right;vertical-align:top;font-family:monospace;font-weight:700;color:{color};">
                        {heat if heat is not None else '—'}/10
                    </td>
                </tr>""")
        section_trends_html = f"""
            <tr><td style="padding:24px 16px 6px;">
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#B32A22;font-weight:600;">Tendencias emergentes</div>
                <p style="margin:6px 0 8px;font-size:14px;">{nt} tendencia{'s' if nt != 1 else ''} con momentum fuerte detectada{'s' if nt != 1 else ''} esta semana:</p>
            </td></tr>
            <tr><td>
                <table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{''.join(rows)}</table>
            </td></tr>"""

    # ---------- Section 2: your-companies news ----------
    section_companies_html = ""
    if has_companies:
        c_rows = []
        for c in companies:
            tk = c.get("ticker")
            name = c.get("name") or tk
            ds = c.get("days_since")
            stale = (ds or 0) >= STALE_DAYS
            age_color = "#B32A22" if stale else "#4A4A4A"
            age_label = f"{ds} días" if ds is not None else "—"
            company_link = name
            if base_url:
                href = f"{base_url}/company/{urllib.parse.quote(tk, safe='')}"
                company_link = (
                    f'<a href="{href}" style="color:#052049;text-decoration:none;border-bottom:1px solid #05204940;" '
                    f'target="_blank" rel="noopener">{name}</a>'
                )
            news_items = news_by_ticker.get(tk) or []
            if news_items:
                news_html = "".join(
                    f'<div style="margin-top:8px;padding:8px 10px;background:#FBF3E0;border-left:3px solid #B8860B;">'
                    f'<div style="font-size:13px;font-weight:600;color:#222;">{n.get("headline","")}</div>'
                    f'<div style="font-size:12px;color:#4A4A4A;margin-top:3px;line-height:1.45;">{n.get("summary","")}</div>'
                    f'<div style="font-size:11px;color:#7a5a10;margin-top:4px;line-height:1.45;"><strong>Por qué importa:</strong> {n.get("why_it_matters","")}</div>'
                    + (f'<div style="font-size:11px;margin-top:4px;"><a href="{n.get("url")}" style="color:#052049;" target="_blank" rel="noopener">Fuente →</a></div>' if n.get("url") else "")
                    + "</div>"
                    for n in news_items
                )
            else:
                news_html = '<div style="margin-top:6px;font-size:11px;color:#9CA3AF;font-style:italic;">Sin noticias materiales esta semana.</div>'
            c_rows.append(f"""
                <tr><td style="padding:14px 12px;border-bottom:1px solid #00000010;vertical-align:top;">
                    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
                        <div style="font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;">
                            <span style="font-family:monospace;font-size:13px;color:#B32A22;">{tk}</span> · {company_link}
                        </div>
                        <div style="font-family:monospace;font-size:11px;color:{age_color};font-weight:600;white-space:nowrap;">{age_label}</div>
                    </div>
                    {news_html}
                </td></tr>""")
        stale_banner = ""
        if any_stale:
            stale_banner = (
                '<div style="margin:8px 0 12px;padding:10px 12px;background:#FBE9E7;border:1px solid #B32A22;font-size:12px;color:#7a1810;line-height:1.5;">'
                '<strong>Aviso:</strong> alguna(s) de tus empresas llevan más de '
                f'{STALE_DAYS} días desde que se generó su plan. Si hay noticias materiales o el flujo es viejo, '
                'considera <strong>regenerar la empresa</strong> (Empresa → Tesis → Reescribir) para que sus scores '
                'cualitativos, TAM y narrativa se actualicen. El refresco semanal de la app solo toca lo cuantitativo '
                '(fundamentales, TAM Score), nunca el componente cualitativo.'
                '</div>'
            )
        section_companies_html = f"""
            <tr><td style="padding:24px 16px 6px;">
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#B32A22;font-weight:600;">Noticias de tus empresas</div>
                <p style="margin:6px 0 4px;font-size:14px;">Empresas con plan completo en tu cartera analítica · ordenadas por antigüedad del plan.</p>
                {stale_banner}
            </td></tr>
            <tr><td>
                <table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{''.join(c_rows)}</table>
            </td></tr>"""

    # ---------- Intro paragraph ----------
    parts = []
    if trends and has_companies:
        intro = f"{greeting} el radar trae {nt} tendencia{'s' if nt != 1 else ''} emergente{'s' if nt != 1 else ''} y noticias sobre {len(companies)} empresa{'s' if len(companies) != 1 else ''} de tu cartera."
    elif trends:
        intro = f"{greeting} el radar trae {nt} tendencia{'s' if nt != 1 else ''} emergente{'s' if nt != 1 else ''} esta semana."
    elif has_companies:
        intro = f"{greeting} sin nuevas tendencias esta semana. Te paso noticias y antigüedad de tus {len(companies)} empresa{'s' if len(companies) != 1 else ''} con plan."
    else:
        intro = f"{greeting} el radar no ha encontrado novedades esta semana."
    parts.append(intro)
    if any_news:
        parts.append("Cada noticia indica por qué cambia o refuerza la tesis.")

    return f"""
        <table width="100%" cellspacing="0" cellpadding="0" style="font-family:sans-serif;color:#111;max-width:620px;margin:0 auto;">
            <tr><td style="padding:24px 16px 8px;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:28px;">Valuation Studio</div>
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4A4A4A;">Radar semanal</div>
            </td></tr>
            <tr><td style="padding:8px 16px 4px;">
                <p style="margin:0 0 6px;font-size:14px;line-height:1.5;">{' '.join(parts)}</p>
            </td></tr>
            {section_trends_html}
            {section_companies_html}
            <tr><td style="padding:16px;font-size:11px;color:#4A4A4A;line-height:1.5;">
                Pulsa los nombres de tendencia o empresa para abrirlos directamente en la app.
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


async def build_preview_for_user(db, user_id: str, trends: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Render the radar email body for ONE user without sending. Used by the
    admin preview endpoint so the user can eyeball the layout before any cron
    runs. If `trends` is None, no trend section is rendered (companies-only
    preview); useful when you just want to validate the new section."""
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "name": 1, "email": 1})
    user_name = (user or {}).get("name") or ""
    companies = await collect_user_companies(db, user_id)
    news = await run_company_news_watch(companies) if companies else {"important": []}
    news_by_ticker: Dict[str, List[Dict[str, Any]]] = {}
    for it in (news.get("important") or []):
        news_by_ticker.setdefault(it["ticker"], []).append(it)
    # Sort by days_since DESC so the oldest plan surfaces first (matches the
    # stale-banner intent — those are the ones the user should consider regenerating).
    companies = sorted(companies, key=lambda c: -(c.get("days_since") or 0))
    html = _build_radar_email_html(user_name, list(trends or []), companies, news_by_ticker)
    return {
        "user_id": user_id,
        "email": (user or {}).get("email"),
        "companies_count": len(companies),
        "news_items_count": sum(len(v) for v in news_by_ticker.values()),
        "html": html,
    }


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

    # 3. Per-user company news (union of all opted-in users → single LLM call).
    cursor = db.users.find({"radar.enabled": True}, {"_id": 0})
    users = [u async for u in cursor]
    summary["subscribers"] = len(users)

    per_user_companies: Dict[str, List[Dict[str, Any]]] = {}
    union: Dict[str, Dict[str, Any]] = {}
    for u in users:
        uid = u.get("user_id")
        if not uid:
            continue
        cs = await collect_user_companies(db, uid)
        per_user_companies[uid] = cs
        for c in cs:
            union.setdefault(c["ticker"], {"ticker": c["ticker"], "name": c["name"]})
    news_by_ticker: Dict[str, List[Dict[str, Any]]] = {}
    if union:
        try:
            news = await run_company_news_watch(list(union.values()))
            for it in (news.get("important") or []):
                news_by_ticker.setdefault(it["ticker"], []).append(it)
        except Exception as e:
            logger.error(f"company news watch failed: {e}")

    # 4. Send. Email is dispatched if EITHER the user has new trends OR they
    # have any subscribed companies (so the stale-flow reminder also lands).
    if new_trends or per_user_companies:
        for u in users:
            uid = u.get("user_id")
            email = u.get("email")
            if not (uid and email):
                continue
            cs = sorted(per_user_companies.get(uid, []), key=lambda c: -(c.get("days_since") or 0))
            user_news_keys = {c["ticker"] for c in cs}
            user_news = {tk: items for tk, items in news_by_ticker.items() if tk in user_news_keys}
            if not new_trends and not cs:
                continue  # nothing to say to this user
            n_news = sum(len(v) for v in user_news.values())
            subject_bits = []
            if new_trends:
                subject_bits.append(f"{len(new_trends)} tendencia{'s' if len(new_trends) != 1 else ''} emergente{'s' if len(new_trends) != 1 else ''}")
            if n_news:
                subject_bits.append(f"{n_news} noticia{'s' if n_news != 1 else ''} de tus empresas")
            subject = "Radar · " + " · ".join(subject_bits) if subject_bits else "Radar semanal"
            html = _build_radar_email_html(u.get("name") or "", new_trends, cs, user_news)
            if await _send_email_resend(email, subject, html):
                summary["emails_sent"] += 1

    # 5. Persist the updated seen set (cap size).
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

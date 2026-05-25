"""Nightly screener: scans every authenticated user's watchlist and notifies
them when a stock crosses an interesting threshold (cara → barata or vice
versa) since the last run. Emails go through Resend.

Designed as a single async job that:
  1. Reads all users with `notify.enabled = True`.
  2. For each watchlist entry, fetches fresh fundamentals (reusing the same
     fetch_fundamentals_sync used by the main API + the cached values in
     `db.fundamentals`).
  3. Re-applies the user's saved overrides (mode == 'manual') so the math
     matches what they see on screen.
  4. Compares the new signal (CARA/JUSTA/BARATA) with the snapshot stored in
     `db.screener_last_signals` keyed by (user_id, ticker).
  5. Sends an email summarising the transitions and stores the new snapshots.
"""
import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
import resend

logger = logging.getLogger(__name__)

# Default thresholds when the user has not customised them
DEFAULT_CHEAP = 20.0
DEFAULT_FAIR = 0.0


def _signal_for(pct: Optional[float], cheap: float, fair: float) -> str:
    if pct is None:
        return "—"
    if pct >= cheap:
        return "BARATA"
    if pct >= fair:
        return "JUSTA"
    return "CARA"


def _crossed_into_buy_zone(prev: str, now: str) -> bool:
    return prev != "BARATA" and now == "BARATA"


def _crossed_out_of_buy_zone(prev: str, now: str) -> bool:
    return prev == "BARATA" and now != "BARATA"


def _build_email_html(user_name: str, events: List[Dict[str, Any]]) -> str:
    rows = []
    for e in events:
        color = "#1D7044" if e["direction"] == "into_buy" else "#B32A22"
        arrow = "→" if e["direction"] == "into_buy" else "←"
        rows.append(f"""
            <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #00000010;font-family:monospace;font-weight:600;">{e['ticker']}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #00000010;font-family:sans-serif;">
                    <span style="color:#4A4A4A;">{e['prev_signal']}</span>
                    <span style="color:{color};margin:0 6px;">{arrow}</span>
                    <span style="color:{color};font-weight:600;">{e['now_signal']}</span>
                </td>
                <td style="padding:8px 12px;border-bottom:1px solid #00000010;text-align:right;font-family:monospace;color:{color};">
                    {e['now_ratio_compra']:+.1f}%
                </td>
            </tr>""")
    rows_html = "".join(rows)
    greeting = f"Hola {user_name.split()[0]}," if user_name else "Hola,"
    return f"""
        <table width="100%" cellspacing="0" cellpadding="0" style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;">
            <tr><td style="padding:24px 16px 8px;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:28px;">Valuation Studio</div>
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4A4A4A;">Screener nocturno</div>
            </td></tr>
            <tr><td style="padding:8px 16px 16px;">
                <p style="margin:0 0 8px;font-size:14px;">{greeting} hoy hay {len(events)} movimiento{'s' if len(events) != 1 else ''} en tu watchlist:</p>
            </td></tr>
            <tr><td>
                <table width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">{rows_html}</table>
            </td></tr>
            <tr><td style="padding:16px;font-size:11px;color:#4A4A4A;line-height:1.5;">
                Aviso: Esta notificación se basa en datos automáticos de Yahoo Finance y tu fórmula propia.
                No es recomendación ni asesoramiento de inversión. Para silenciar las notificaciones, entra a la app y desactívalas en tu perfil.
            </td></tr>
        </table>
    """


async def _send_email_resend(to_addr: str, subject: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    if not api_key:
        logger.error("RESEND_API_KEY not configured; skipping email.")
        return False
    resend.api_key = api_key
    try:
        result = await asyncio.to_thread(resend.Emails.send, {
            "from": sender,
            "to": [to_addr],
            "subject": subject,
            "html": html,
        })
        logger.info(f"Email sent to {to_addr}: {result.get('id')}")
        return True
    except Exception as e:
        logger.error(f"Resend send failed for {to_addr}: {e}")
        return False


async def run_screener(db, get_company_data, compute_custom_ratios) -> Dict[str, Any]:
    """Scans every opted-in user and sends emails on signal transitions.

    Parameters allow us to inject server.py helpers without circular imports.
    """
    summary = {"users_scanned": 0, "emails_sent": 0, "events": 0}

    cursor = db.users.find({"notify.enabled": True}, {"_id": 0})
    users = [u async for u in cursor]

    for user in users:
        user_id = user["user_id"]
        email = user.get("email")
        if not email:
            continue
        summary["users_scanned"] += 1

        wl_doc = await db.user_watchlists.find_one({"user_id": user_id}, {"_id": 0})
        entries = (wl_doc or {}).get("entries", [])
        if not entries:
            continue

        # User thresholds: we don't sync them server-side yet → use defaults.
        cheap, fair = DEFAULT_CHEAP, DEFAULT_FAIR
        prefs = user.get("notify") or {}
        want_buy = prefs.get("cross_buy_zone", True)
        want_sell = prefs.get("cross_sell_zone", True)

        events = []
        for entry in entries:
            ticker = entry.get("ticker")
            if not ticker:
                continue
            try:
                data = await get_company_data(ticker, force_refresh=True)
            except Exception as e:
                logger.warning(f"screener: fetch {ticker} for {email} failed: {e}")
                continue

            # Build inputs (auto + user overrides)
            auto = {
                "revenue_2y": data.get("auto_projections", {}).get("revenue_2y"),
                "fcf_2y": data.get("auto_projections", {}).get("fcf_2y"),
                "shares_outstanding": data.get("shares_outstanding"),
                "gross_margin": data.get("gross_margin"),
                "operating_margin": data.get("operating_margin"),
                "net_debt": data.get("net_debt"),
                "market_cap": data.get("market_cap"),
                "revenue_cagr_4y": data.get("auto_projections", {}).get("revenue_cagr_4y"),
                "fcf_cagr_4y": data.get("auto_projections", {}).get("fcf_cagr_4y"),
                "current_price": data.get("current_price"),
            }
            overrides = entry.get("overrides") or {}
            merged = {**auto, **{k: v for k, v in overrides.items() if k != "current_price"}}
            ratios = compute_custom_ratios(merged)
            now_rc = ratios.get("ratio_compra_pct")
            now_rv = ratios.get("ratio_venta_pct")
            now_signal = _signal_for(now_rc, cheap, fair)

            prev_doc = await db.screener_last_signals.find_one(
                {"user_id": user_id, "ticker": ticker}, {"_id": 0}
            )
            prev_signal = (prev_doc or {}).get("signal") or "—"

            direction = None
            if want_buy and _crossed_into_buy_zone(prev_signal, now_signal):
                direction = "into_buy"
            elif want_sell and _crossed_out_of_buy_zone(prev_signal, now_signal):
                direction = "out_of_buy"

            if direction and prev_signal != "—":
                events.append({
                    "ticker": ticker,
                    "prev_signal": prev_signal,
                    "now_signal": now_signal,
                    "now_ratio_compra": now_rc or 0.0,
                    "now_ratio_venta": now_rv or 0.0,
                    "direction": direction,
                })

            await db.screener_last_signals.update_one(
                {"user_id": user_id, "ticker": ticker},
                {"$set": {
                    "user_id": user_id,
                    "ticker": ticker,
                    "signal": now_signal,
                    "ratio_compra_pct": now_rc,
                    "ratio_venta_pct": now_rv,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )

        if events:
            summary["events"] += len(events)
            subject = f"Valuation Studio · {len(events)} movimiento{'s' if len(events) != 1 else ''} en tu watchlist"
            html = _build_email_html(user.get("name") or "", events)
            sent = await _send_email_resend(email, subject, html)
            if sent:
                summary["emails_sent"] += 1

    logger.info(f"Screener run summary: {summary}")
    return summary

"""Emergent-managed Google Auth integration for Valuation Studio.

Login is OPTIONAL — anonymous users keep using localStorage. When the user
logs in, their watchlist syncs across devices via the /api/watchlist endpoints.

Flow:
  1. Frontend redirects to https://auth.emergentagent.com/?redirect=<dashboard URL>
  2. After Google OAuth, user lands at <dashboard URL>#session_id=<id>
  3. Frontend posts that session_id to POST /api/auth/session
  4. Backend exchanges session_id with Emergent → session_token (7d expiry)
  5. session_token is stored httpOnly cookie + DB row
"""
import os
import uuid
import logging
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any, Dict
from fastapi import APIRouter, HTTPException, Request, Response, Cookie, Header, Depends
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_DURATION = timedelta(days=7)


class SessionExchange(BaseModel):
    session_id: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None


class WatchlistEntry(BaseModel):
    ticker: str
    mode: str = "auto"  # "auto" | "manual"
    overrides: Optional[Dict[str, Any]] = None
    saved_at: Optional[str] = None
    # Per-entry email alert opt-in (overrides nothing — combined with notify.enabled in the screener)
    alert_enabled: Optional[bool] = False


class WatchlistPayload(BaseModel):
    entries: List[WatchlistEntry]
    deletions: Optional[Dict[str, str]] = None  # {ticker: deletedAtISO} — propagates removals across devices


class PortfolioEntry(BaseModel):
    ticker: str
    shares: Optional[float] = None  # optional — user can save a ticker without position size
    buy_price: Optional[float] = None  # optional — fillable later
    buy_currency: Optional[str] = None  # if None, treat as the native currency of the ticker
    buy_date: Optional[str] = None    # ISO date
    note: Optional[str] = None
    alert_enabled: Optional[bool] = False
    # Manual override snapshot — mirrors the watchlist semantics.
    # When mode == "manual", `overrides` carries the user-edited inputs; the
    # frontend recomputes ratios with these overrides on top of the live Yahoo
    # data so the displayed Ratio Compra/Venta stays consistent across refresh.
    mode: Optional[str] = "auto"
    overrides: Optional[Dict[str, Any]] = None
    saved_at: Optional[str] = None


class PortfolioPayload(BaseModel):
    positions: List[PortfolioEntry]
    deletions: Optional[Dict[str, str]] = None  # {ticker: deletedAtISO} — propagates removals across devices


class NotificationPreferences(BaseModel):
    enabled: bool = False
    cross_buy_zone: bool = True   # alert when ratio_compra crosses into cheap zone
    cross_sell_zone: bool = True  # alert when ratio_venta crosses into cheap zone


def _resolve_token(session_token_cookie: Optional[str], authorization: Optional[str]) -> Optional[str]:
    """Token resolution order: httpOnly cookie → Bearer header fallback."""
    if session_token_cookie:
        return session_token_cookie
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip() or None
    return None


def make_router(db: AsyncIOMotorDatabase) -> APIRouter:
    router = APIRouter(prefix="/auth")

    async def _get_session_user(token: str) -> Optional[Dict[str, Any]]:
        if not token:
            return None
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not session:
            return None
        # Expiry check — be defensive about timezone-naive datetimes coming from Mongo.
        exp = session.get("expires_at")
        if isinstance(exp, str):
            exp = datetime.fromisoformat(exp)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return None
        user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
        return user

    async def get_current_user_optional(
        session_token: Optional[str] = Cookie(default=None),
        authorization: Optional[str] = Header(default=None),
    ) -> Optional[Dict[str, Any]]:
        token = _resolve_token(session_token, authorization)
        return await _get_session_user(token) if token else None

    async def get_current_user(
        user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
    ) -> Dict[str, Any]:
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    @router.post("/session")
    async def exchange_session(payload: SessionExchange, response: Response):
        """Exchange Emergent session_id for our session_token + user data."""
        # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": payload.session_id})
                if r.status_code != 200:
                    logger.warning(f"Emergent /session-data returned {r.status_code}: {r.text[:200]}")
                    raise HTTPException(status_code=401, detail="Invalid Emergent session")
                data = r.json()
        except httpx.RequestError as e:
            logger.error(f"Emergent auth request failed: {e}")
            raise HTTPException(status_code=502, detail="Auth provider unreachable")

        email = data.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="Auth provider returned no email")

        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            user_id = existing["user_id"]
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {
                    "name": data.get("name") or existing.get("name"),
                    "picture": data.get("picture") or existing.get("picture"),
                    "last_login": datetime.now(timezone.utc).isoformat(),
                }},
            )
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": user_id,
                "email": email,
                "name": data.get("name"),
                "picture": data.get("picture"),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_login": datetime.now(timezone.utc).isoformat(),
                "notify": NotificationPreferences().model_dump(),
            })

        session_token = data.get("session_token") or uuid.uuid4().hex
        expires_at = datetime.now(timezone.utc) + SESSION_DURATION
        await db.user_sessions.insert_one({
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        })

        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            secure=True,
            samesite="none",
            max_age=int(SESSION_DURATION.total_seconds()),
            path="/",
        )
        user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        return {
            "user": UserOut(**{k: user_doc.get(k) for k in ["user_id", "email", "name", "picture"]}).model_dump(),
        }

    @router.get("/me")
    async def me(user: Dict[str, Any] = Depends(get_current_user)):
        return UserOut(**{k: user.get(k) for k in ["user_id", "email", "name", "picture"]}).model_dump()

    @router.post("/logout")
    async def logout(
        response: Response,
        session_token: Optional[str] = Cookie(default=None),
        authorization: Optional[str] = Header(default=None),
    ):
        token = _resolve_token(session_token, authorization)
        if token:
            await db.user_sessions.delete_many({"session_token": token})
        response.delete_cookie("session_token", path="/", samesite="none", secure=True)
        return {"ok": True}

    # ---------------- Watchlist sync (per user) ----------------
    @router.get("/watchlist")
    async def get_watchlist(user: Dict[str, Any] = Depends(get_current_user)):
        doc = await db.user_watchlists.find_one({"user_id": user["user_id"]}, {"_id": 0})
        return {"entries": (doc or {}).get("entries", []), "deletions": (doc or {}).get("deletions", {})}

    @router.put("/watchlist")
    async def put_watchlist(payload: WatchlistPayload, user: Dict[str, Any] = Depends(get_current_user)):
        entries = [e.model_dump() for e in payload.entries]
        await db.user_watchlists.update_one(
            {"user_id": user["user_id"]},
            {"$set": {
                "user_id": user["user_id"],
                "entries": entries,
                "deletions": payload.deletions or {},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        return {"ok": True, "count": len(entries)}

    # ---------------- Portfolio (real positions) ----------------
    @router.get("/portfolio")
    async def get_portfolio(user: Dict[str, Any] = Depends(get_current_user)):
        doc = await db.user_portfolios.find_one({"user_id": user["user_id"]}, {"_id": 0})
        return {"positions": (doc or {}).get("positions", []), "deletions": (doc or {}).get("deletions", {})}

    @router.put("/portfolio")
    async def put_portfolio(payload: PortfolioPayload, user: Dict[str, Any] = Depends(get_current_user)):
        positions = [p.model_dump() for p in payload.positions]
        await db.user_portfolios.update_one(
            {"user_id": user["user_id"]},
            {"$set": {
                "user_id": user["user_id"],
                "positions": positions,
                "deletions": payload.deletions or {},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        return {"ok": True, "count": len(positions)}

    # ---------------- Notification preferences ----------------
    @router.get("/notify")
    async def get_notify(user: Dict[str, Any] = Depends(get_current_user)):
        return user.get("notify") or NotificationPreferences().model_dump()

    @router.put("/notify")
    async def put_notify(prefs: NotificationPreferences, user: Dict[str, Any] = Depends(get_current_user)):
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"notify": prefs.model_dump()}},
        )
        return {"ok": True, "prefs": prefs.model_dump()}

    return router, get_current_user, get_current_user_optional

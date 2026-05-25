"""Tests for new features: portfolio endpoints, watchlist alert_enabled persistence,
screener still works, language toggle endpoints.

Auth-protected endpoints are tested by inserting a fake user + session directly
into MongoDB (db.users, db.user_sessions), then calling the endpoint with
Authorization: Bearer <token>. Cleanup happens in fixture teardown.
"""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- Auth gating: protected endpoints return 401 without token ----------
def test_portfolio_get_no_auth():
    r = requests.get(f"{API}/auth/portfolio", timeout=15)
    assert r.status_code == 401, r.text


def test_portfolio_put_no_auth():
    r = requests.put(f"{API}/auth/portfolio", json={"positions": []}, timeout=15)
    assert r.status_code == 401, r.text


def test_watchlist_get_no_auth():
    r = requests.get(f"{API}/auth/watchlist", timeout=15)
    assert r.status_code == 401


def test_auth_me_no_token():
    r = requests.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 401


# ---------- Existing endpoints still work ----------
def test_fx_rates_still_works():
    r = requests.get(f"{API}/fx/rates", timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert data["base"] == "USD"
    assert data["count"] >= 100


def test_company_aapl_still_works():
    r = requests.get(f"{API}/company/AAPL", timeout=120)
    assert r.status_code == 200
    d = r.json()
    assert d["ticker"] == "AAPL"
    assert d["current_price"] > 0


def test_screener_still_works():
    r = requests.post(f"{API}/admin/run-screener", timeout=300)
    assert r.status_code == 200
    d = r.json()
    for k in ["users_scanned", "emails_sent", "events"]:
        assert k in d, f"missing key {k}; payload: {d}"
    assert isinstance(d["users_scanned"], int)


# ---------- Auth flows with seeded session ----------
TEST_USER_PREFIX = "TEST_pf_"


@pytest.fixture(scope="module")
def seeded_session():
    """Insert a user + session directly into Mongo; yield (token, user_id, db).

    Cleanup deletes user + session + watchlist + portfolio docs after the
    module's tests finish.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    user_id = f"{TEST_USER_PREFIX}{uuid.uuid4().hex[:8]}"
    email = f"{user_id}@example.com"
    token = uuid.uuid4().hex

    async def setup():
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": "Test Portfolio User",
            "picture": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_login": datetime.now(timezone.utc).isoformat(),
            "notify": {"enabled": False, "cross_buy_zone": True, "cross_sell_zone": True},
        })
        await db.user_sessions.insert_one({
            "user_id": user_id,
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })

    async def teardown():
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.user_watchlists.delete_many({"user_id": user_id})
        await db.user_portfolios.delete_many({"user_id": user_id})
        await db.users.delete_many({"user_id": user_id})
        client.close()

    loop.run_until_complete(setup())
    yield {"token": token, "user_id": user_id, "email": email}
    loop.run_until_complete(teardown())
    loop.close()


def _auth_headers(seeded):
    return {"Authorization": f"Bearer {seeded['token']}", "Content-Type": "application/json"}


def test_authed_me(seeded_session):
    r = requests.get(f"{API}/auth/me", headers=_auth_headers(seeded_session), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user_id"] == seeded_session["user_id"]
    assert d["email"] == seeded_session["email"]


def test_watchlist_alert_enabled_persists(seeded_session):
    headers = _auth_headers(seeded_session)
    payload = {"entries": [
        {"ticker": "AAPL", "mode": "auto", "alert_enabled": True},
        {"ticker": "MSFT", "mode": "auto", "alert_enabled": False},
    ]}
    r = requests.put(f"{API}/auth/watchlist", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True
    assert r.json().get("count") == 2

    g = requests.get(f"{API}/auth/watchlist", headers=headers, timeout=15)
    assert g.status_code == 200
    entries = g.json().get("entries", [])
    assert len(entries) == 2
    by_t = {e["ticker"]: e for e in entries}
    assert by_t["AAPL"]["alert_enabled"] is True
    assert by_t["MSFT"]["alert_enabled"] is False


def test_portfolio_crud_with_alert(seeded_session):
    headers = _auth_headers(seeded_session)
    payload = {"positions": [
        {
            "ticker": "AAPL",
            "shares": 10.0,
            "buy_price": 150.0,
            "buy_currency": "USD",
            "buy_date": "2024-01-15",
            "note": "test position",
            "alert_enabled": True,
        },
        {
            "ticker": "SAP.DE",
            "shares": 5.5,
            "buy_price": 140.25,
            "buy_currency": "EUR",
            "buy_date": None,
            "note": None,
            "alert_enabled": False,
        },
    ]}
    r = requests.put(f"{API}/auth/portfolio", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("count") == 2

    g = requests.get(f"{API}/auth/portfolio", headers=headers, timeout=15)
    assert g.status_code == 200, g.text
    positions = g.json().get("positions", [])
    assert len(positions) == 2
    by_t = {p["ticker"]: p for p in positions}
    aapl = by_t["AAPL"]
    assert aapl["shares"] == 10.0
    assert aapl["buy_price"] == 150.0
    assert aapl["buy_currency"] == "USD"
    assert aapl["buy_date"] == "2024-01-15"
    assert aapl["note"] == "test position"
    assert aapl["alert_enabled"] is True
    sap = by_t["SAP.DE"]
    assert sap["shares"] == 5.5
    assert sap["buy_currency"] == "EUR"
    assert sap["alert_enabled"] is False


def test_portfolio_replace_overwrites(seeded_session):
    headers = _auth_headers(seeded_session)
    # Replace with single new position
    payload = {"positions": [
        {"ticker": "GOOG", "shares": 2.0, "buy_price": 100.0, "alert_enabled": True}
    ]}
    r = requests.put(f"{API}/auth/portfolio", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200
    g = requests.get(f"{API}/auth/portfolio", headers=headers, timeout=15)
    positions = g.json()["positions"]
    assert len(positions) == 1
    assert positions[0]["ticker"] == "GOOG"


def test_portfolio_validation_rejects_bad_payload(seeded_session):
    headers = _auth_headers(seeded_session)
    # Missing required field "shares"
    payload = {"positions": [{"ticker": "AAPL", "buy_price": 100.0}]}
    r = requests.put(f"{API}/auth/portfolio", json=payload, headers=headers, timeout=15)
    assert r.status_code in (400, 422), r.text

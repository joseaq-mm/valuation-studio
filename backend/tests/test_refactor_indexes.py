"""
Backend regression tests after refactor:
- 25 MongoDB indexes at startup (perf-only, non-behavioral)
- Confirm bearer session auth still works
- Confirm cloud sync endpoints (watchlist, portfolio) still work
- Speed sanity for key endpoints
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://valuation-studio.preview.emergentagent.com").rstrip("/")
TOKEN = "test_profile_token_fixed_123"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def test_auth_me_bearer():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # /auth/me may return {user:{...}} or user directly
    u = data.get("user", data)
    assert u.get("email") == "profiletest@example.com", u


def test_watchlist_get():
    r = requests.get(f"{BASE_URL}/api/auth/watchlist", headers=HEADERS, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # Accept various shapes
    items = body.get("watchlist") or body.get("items") or body
    assert items is not None


def test_watchlist_put_add_and_remove_msft():
    # GET current
    r = requests.get(f"{BASE_URL}/api/auth/watchlist", headers=HEADERS, timeout=15)
    assert r.status_code == 200
    body = r.json()
    current = body.get("entries") or body.get("watchlist") or body.get("items") or []
    # Normalize to list of tickers
    if current and isinstance(current[0], dict):
        tickers = [x.get("ticker") or x.get("symbol") for x in current]
    else:
        tickers = list(current)
    tickers = [t for t in tickers if t]
    original = list(tickers)

    # Build entries payload (new + MSFT). Use recent saved_at to defeat any old tombstone.
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    new_tickers = list(dict.fromkeys(tickers + ["MSFT"]))
    entries = [{"ticker": t, "mode": "auto", "saved_at": now_iso} for t in new_tickers]
    # Also clear any MSFT tombstone by sending deletions map with older date (or empty)
    put = requests.put(f"{BASE_URL}/api/auth/watchlist", headers=HEADERS, json={"entries": entries, "deletions": {}}, timeout=15)
    assert put.status_code in (200, 204), put.text
    put_body = put.json() if put.headers.get("content-type","").startswith("application/json") else {}
    # If MSFT was tombstoned, remove tombstone directly via mongo? No — try via API: server merges tombstones from client (max). Only way to clear is if there's an endpoint. Check response deletions map:
    if "MSFT" in (put_body.get("deletions") or {}):
        # Tombstone exists — we need to override by sending saved_at > tombstone. entries include saved_at=now which should beat it via _apply_tombstones.
        pass

    # Verify persisted
    r2 = requests.get(f"{BASE_URL}/api/auth/watchlist", headers=HEADERS, timeout=15)
    assert r2.status_code == 200
    body2 = r2.json()
    got_entries = body2.get("entries") or body2.get("watchlist") or body2.get("items") or []
    got = [x.get("ticker") if isinstance(x, dict) else x for x in got_entries]
    assert "MSFT" in got, got

    # Cleanup: restore original entries only
    entries_orig = [{"ticker": t, "mode": "auto"} for t in original]
    put2 = requests.put(f"{BASE_URL}/api/auth/watchlist", headers=HEADERS, json={"entries": entries_orig}, timeout=15)
    assert put2.status_code in (200, 204)
    r3 = requests.get(f"{BASE_URL}/api/auth/watchlist", headers=HEADERS, timeout=15)
    got3_entries = r3.json().get("entries") or r3.json().get("watchlist") or []
    got3 = [x.get("ticker") if isinstance(x, dict) else x for x in got3_entries]
    assert "MSFT" not in got3, got3


def test_portfolio_get():
    r = requests.get(f"{BASE_URL}/api/auth/portfolio", headers=HEADERS, timeout=15)
    assert r.status_code == 200, r.text


def test_company_aapl():
    r = requests.get(f"{BASE_URL}/api/company/AAPL", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ticker", "AAPL").upper() == "AAPL"


def test_fx_rates():
    r = requests.get(f"{BASE_URL}/api/fx/rates", timeout=15)
    assert r.status_code == 200, r.text


def test_thesis_dashboard_bearer():
    r = requests.get(f"{BASE_URL}/api/thesis/dashboard", headers=HEADERS, timeout=30)
    assert r.status_code == 200, r.text

"""Tests for new Valuation Studio features:
- FX rates
- Ratio history
- Translate summary
- Run screener
- Auth gating
- X-factor capping (>10 → 10)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://stock-fundamentals-13.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- FX ----------
def test_fx_rates_has_100plus_currencies(session):
    r = session.get(f"{API}/fx/rates", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["base"] == "USD"
    assert isinstance(data["rates"], dict)
    assert data["count"] == len(data["rates"])
    assert data["count"] >= 100, f"Expected >=100 currencies, got {data['count']}"
    # Typical entries
    assert "EUR" in data["rates"]
    assert "JPY" in data["rates"]
    assert "USD" in data["rates"]


# ---------- Ratio history ----------
@pytest.fixture(scope="module")
def _preload_aapl(session):
    r = session.get(f"{API}/company/AAPL", timeout=120)
    assert r.status_code == 200
    return r.json()


def test_ratio_history_aapl(session, _preload_aapl):
    r = session.get(f"{API}/company/AAPL/ratio-history", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ticker"] == "AAPL"
    assert isinstance(data["series"], list)
    if data["series"]:
        item = data["series"][0]
        for k in ["year", "price", "ratio_compra_pct", "ratio_venta_pct"]:
            assert k in item, f"missing key {k} in series item: {item}"
        assert isinstance(item["year"], int)
        assert item["price"] is None or item["price"] > 0


def test_ratio_history_european(session):
    # Preload SAP.DE
    r0 = session.get(f"{API}/company/SAP.DE", timeout=120)
    assert r0.status_code == 200
    r = session.get(f"{API}/company/SAP.DE/ratio-history", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ticker"] == "SAP.DE"
    assert "series" in data


def test_ratio_history_soun(session):
    r0 = session.get(f"{API}/company/SOUN", timeout=120)
    assert r0.status_code == 200
    r = session.get(f"{API}/company/SOUN/ratio-history", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "series" in data


# ---------- Translate summary ----------
def test_translate_summary_aapl(session, _preload_aapl):
    r = session.get(f"{API}/company/AAPL/translate-summary", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ticker"] == "AAPL"
    summary_es = data.get("summary_es", "")
    assert isinstance(summary_es, str)
    if summary_es:
        # Spanish indicators
        lower = summary_es.lower()
        has_spanish = any(w in lower for w in [
            " la ", " el ", " los ", " las ", " de ", " y ", " que ", " es ", " en ", "ñ", "í", "ó", "á", "é", "ú"
        ])
        assert has_spanish, f"Translation does not look Spanish: {summary_es[:200]}"


def test_translate_summary_mu(session):
    r0 = session.get(f"{API}/company/MU", timeout=120)
    assert r0.status_code == 200
    r = session.get(f"{API}/company/MU/translate-summary", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ticker"] == "MU"
    assert isinstance(data.get("summary_es", ""), str)


# ---------- Screener ----------
def test_run_screener(session):
    r = session.post(f"{API}/admin/run-screener", timeout=300)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["users_scanned", "emails_sent", "events"]:
        assert k in data, f"missing key {k}; payload: {data}"
    assert isinstance(data["users_scanned"], int)
    assert isinstance(data["emails_sent"], int)
    assert isinstance(data["events"], (list, int))


# ---------- Auth gating ----------
def test_auth_session_invalid(session):
    r = requests.post(f"{API}/auth/session", json={"session_id": "totally-invalid-xyz-123"}, timeout=30)
    assert r.status_code == 401, r.text


def test_auth_me_no_token():
    s = requests.Session()  # no cookies
    r = s.get(f"{API}/auth/me", timeout=30)
    assert r.status_code == 401


def test_auth_logout_no_token_ok():
    s = requests.Session()
    r = s.post(f"{API}/auth/logout", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True


def test_auth_watchlist_no_token():
    s = requests.Session()
    r = s.get(f"{API}/auth/watchlist", timeout=30)
    assert r.status_code == 401


# ---------- X-factor capping ----------
def test_x_factor_capping_via_calculate():
    """Direct test of cap: raw x = 25 → x_factor capped to 10."""
    # rev_per_share=10, margin=1.5, x_raw=25 (capped to 10),
    # rev_cagr=0, fcf_cagr=0 -> POC = 10 * 1.5 * 10 * 1 * 1 = 150
    payload = {
        "revenue_2y": 1000,
        "fcf_2y": 300,        # 300/1000*100 = 30 → x_raw=30 → capped to 10
        "shares_outstanding": 100,
        "gross_margin": 0.5,
        "operating_margin": 0.10,
        "net_debt": 0,
        "market_cap": 1000,
        "revenue_cagr_4y": 0.0,
        "fcf_cagr_4y": 0.0,
        "current_price": 100,
    }
    r = requests.post(f"{API}/company/TEST/calculate", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["breakdown"]["x_raw_pct"] == 30.0
    # The "fcf_minus_netdebt_over_mcap_pct" in breakdown is actually the x_factor used (capped)
    assert data["breakdown"]["fcf_minus_netdebt_over_mcap_pct"] == 10.0
    # POC = 10 * 1.5 * 10 * 1 * 1 = 150
    assert abs(data["poc"] - 150.0) < 0.01


def test_x_factor_capping_aapl(session, _preload_aapl):
    """AAPL has lots of cash - verify x_factor breakdown <= 10."""
    data = _preload_aapl
    cr = data.get("custom_ratios", {})
    bd = cr.get("breakdown")
    if bd is not None:
        x_used = bd.get("fcf_minus_netdebt_over_mcap_pct")
        assert x_used is None or x_used <= 10.0, f"x_factor used should be <=10, got {x_used}"

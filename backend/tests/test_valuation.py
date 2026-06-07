"""Backend tests for Valuation Studio API."""
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


# Root
def test_root(session):
    r = session.get(f"{API}/", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "message" in data
    assert "version" in data


# Company - AAPL fundamentals + custom ratios
def test_company_aapl(session):
    r = session.get(f"{API}/company/AAPL?refresh=true", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "_id" not in data
    assert data["ticker"] == "AAPL"
    assert data["current_price"] is not None and data["current_price"] > 0
    assert data["market_cap"] is not None
    assert "custom_ratios" in data
    cr = data["custom_ratios"]
    # Should have keys regardless of nullability
    for k in ["poc", "pov", "ratio_compra_pct", "ratio_venta_pct", "missing_inputs"]:
        assert k in cr
    assert "auto_projections" in data
    assert "classic_ratios" in data


# Company - European ticker
def test_company_european(session):
    r = session.get(f"{API}/company/SAP.DE", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ticker"] == "SAP.DE"
    assert "_id" not in data
    # Should have a price
    assert data.get("current_price") is not None


# Invalid ticker
def test_company_invalid(session):
    r = session.get(f"{API}/company/INVALIDTICKERZZZZ", timeout=120)
    assert r.status_code == 404


# Search
def test_search_apple(session):
    r = session.get(f"{API}/search", params={"q": "apple"}, timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert "results" in data
    assert isinstance(data["results"], list)
    if data["results"]:
        symbols = [x.get("symbol") for x in data["results"]]
        assert any("AAPL" in (s or "") for s in symbols)


# Compare
def test_compare(session):
    r = session.get(f"{API}/compare", params={"tickers": "AAPL,MSFT"}, timeout=180)
    assert r.status_code == 200
    data = r.json()
    assert "results" in data
    assert len(data["results"]) == 2
    for item in data["results"]:
        assert "_id" not in item
        if "error" not in item:
            assert "custom_ratios" in item


# Calculate - math verification with known inputs
def test_calculate_math():
    # Known inputs - simple verification:
    # revenue_2y=1000, shares=100 -> rev_per_share=10
    # gross_margin=0.5 -> margin_factor=1.5
    # fcf_2y=200, net_debt=50, market_cap=1000 -> x_raw = (200-50)/1000 *100 = 15
    #   x_raw > 10 -> x_factor is CAPPED at 10.0 (extreme-FCF-yield guard).
    # rev_cagr=0.10 -> 1.10; fcf_cagr=0.20 -> 1.20
    # POC = 10 * 1.5 * 10 * 1.10 * 1.20 = 198
    # current_price=100 -> Ratio Compra = (198/100 - 1)*100 = 98
    # operating_margin=0.25 -> y_factor = 1.25 -> POV = 198 * 1.25 = 247.5
    # Ratio Venta = (247.5/100 - 1)*100 = 147.5
    payload = {
        "revenue_2y": 1000,
        "fcf_2y": 200,
        "shares_outstanding": 100,
        "gross_margin": 0.5,
        "operating_margin": 0.25,
        "net_debt": 50,
        "market_cap": 1000,
        "revenue_cagr_4y": 0.10,
        "fcf_cagr_4y": 0.20,
        "current_price": 100,
    }
    r = requests.post(f"{API}/company/TEST/calculate", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["missing_inputs"] == []
    assert abs(data["poc"] - 198.0) < 0.01
    assert abs(data["pov"] - 247.5) < 0.01
    assert abs(data["ratio_compra_pct"] - 98.0) < 0.01
    assert abs(data["ratio_venta_pct"] - 147.5) < 0.01


# Calculate - missing inputs
def test_calculate_missing():
    payload = {"revenue_2y": 1000, "shares_outstanding": 100}
    r = requests.post(f"{API}/company/TEST/calculate", json=payload, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["poc"] is None
    assert data["ratio_compra_pct"] is None
    assert data["ratio_venta_pct"] is None
    assert isinstance(data["missing_inputs"], list)
    assert len(data["missing_inputs"]) > 0


# Cache: second call within TTL should be fast & no _id leak
def test_cache_no_id_leak(session):
    r1 = session.get(f"{API}/company/AAPL", timeout=120)
    assert r1.status_code == 200
    r2 = session.get(f"{API}/company/AAPL", timeout=60)
    assert r2.status_code == 200
    d2 = r2.json()
    assert "_id" not in d2
    assert d2["ticker"] == "AAPL"

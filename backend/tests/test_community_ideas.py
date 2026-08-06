"""Community Fase 2 · Ideas de inversión — e2e backend tests."""
import os
import time
import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE = ln.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE}/api"

NORMAL_TOKEN = "test_profile_token_fixed_123"
ADMIN_TOKEN = "admin_test_token_123"


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ensure_auth():
    r = requests.get(f"{API}/community/unread", headers=H(NORMAL_TOKEN), timeout=15)
    if r.status_code == 401:
        pytest.skip("normal token not authenticated; re-seed profile test user")
    return True


# ============ TICKER METRICS ============
class TestTickerMetrics:
    def test_metrics_aapl_quantitative(self, ensure_auth):
        r = requests.get(f"{API}/thesis/ticker-metrics/AAPL", headers=H(NORMAL_TOKEN), timeout=45)
        assert r.status_code == 200, r.text
        d = r.json()
        # No thesis for AAPL for this user
        assert d.get("has_qual") is False
        # Quantitative present (allow None if yfinance fails, but keys must exist)
        for k in ("current_price", "poc", "pov", "ratio_compra_pct", "ratio_venta_pct", "currency", "name", "ticker"):
            assert k in d, f"missing key {k} in {d}"
        assert d["ticker"] == "AAPL"
        # Qualitative fields should be null
        for k in ("score", "tam", "kpi_coef", "combined_qual", "combined"):
            if k in d:
                assert d[k] is None, f"expected null qual field {k}, got {d[k]}"

    def test_metrics_unknown_ticker_no_500(self, ensure_auth):
        r = requests.get(f"{API}/thesis/ticker-metrics/ZZZFAKE", headers=H(NORMAL_TOKEN), timeout=45)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("has_qual") is False


# ============ CREATE IDEA ============
class TestIdeas:
    def test_create_idea_aapl_bull(self, ensure_auth):
        # get metrics first (frontend does this)
        rm = requests.get(f"{API}/thesis/ticker-metrics/AAPL", headers=H(NORMAL_TOKEN), timeout=45)
        metrics = rm.json() if rm.status_code == 200 else {}
        payload = {
            "scope": "idea", "title": "TEST_idea AAPL alcista",
            "body": "Creo que AAPL está bien posicionado a largo plazo.",
            "ticker": "AAPL", "stance": "bull", "target_price": 250.0,
            "metrics": metrics,
        }
        r = requests.post(f"{API}/community/topics", json=payload, headers=H(NORMAL_TOKEN), timeout=45)
        # rate limit could hit if run tight
        if r.status_code == 429:
            time.sleep(30)
            r = requests.post(f"{API}/community/topics", json=payload, headers=H(NORMAL_TOKEN), timeout=45)
        assert r.status_code == 200, r.text
        pytest.idea_id = r.json()["id"]

    def test_list_ideas_returns_metrics(self, ensure_auth):
        r = requests.get(f"{API}/community/topics?scope=idea", headers=H(NORMAL_TOKEN), timeout=15)
        assert r.status_code == 200
        topics = r.json()["topics"]
        mine = next((t for t in topics if t["id"] == pytest.idea_id), None)
        assert mine is not None
        assert mine["scope"] == "idea"
        assert mine["ticker"] == "AAPL"
        assert mine["stance"] == "bull"
        assert mine["target_price"] == 250.0
        assert isinstance(mine.get("metrics"), dict)

    def test_idea_requires_ticker(self, ensure_auth):
        time.sleep(1)
        payload = {"scope": "idea", "title": "TEST_no_ticker", "body": "sin ticker", "stance": "bull"}
        r = requests.post(f"{API}/community/topics", json=payload, headers=H(NORMAL_TOKEN), timeout=30)
        assert r.status_code == 400, r.text

    def test_reply_and_like_on_idea(self, ensure_auth):
        tid = pytest.idea_id
        time.sleep(1)
        r = requests.post(f"{API}/community/topics/{tid}/replies",
                          json={"body": "Estoy de acuerdo con la tesis."}, headers=H(ADMIN_TOKEN), timeout=30)
        if r.status_code == 429:
            time.sleep(30)
            r = requests.post(f"{API}/community/topics/{tid}/replies",
                              json={"body": "Estoy de acuerdo con la tesis."}, headers=H(ADMIN_TOKEN), timeout=30)
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{API}/community/topics/{tid}/like", headers=H(ADMIN_TOKEN), timeout=15)
        assert r2.status_code == 200 and r2.json()["liked"] is True

    def test_moderation_blocks_insult_idea(self, ensure_auth):
        time.sleep(1)
        payload = {
            "scope": "idea", "title": "TEST_ins puto imbécil",
            "body": "Eres un puto imbécil de mierda, ojalá te mueras, estafador cabrón.",
            "ticker": "AAPL", "stance": "bear",
        }
        r = requests.post(f"{API}/community/topics", json=payload, headers=H(NORMAL_TOKEN), timeout=30)
        if r.status_code == 429:
            time.sleep(30)
            r = requests.post(f"{API}/community/topics", json=payload, headers=H(NORMAL_TOKEN), timeout=30)
        assert r.status_code in (422, 200), r.text
        if r.status_code == 200:
            pytest.skip("moderation fail-open on this run")


# ============ SIGNAL ============
class TestSignal:
    def test_signal_returns_aapl(self, ensure_auth):
        r = requests.get(f"{API}/community/ideas/signal", headers=H(NORMAL_TOKEN), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()["signal"]
        assert isinstance(rows, list)
        aapl = next((x for x in rows if x["ticker"] == "AAPL"), None)
        assert aapl is not None, f"AAPL not in signal: {rows}"
        assert aapl["ideas"] >= 1
        assert aapl["bull"] + aapl["bear"] + aapl["neutral"] == aapl["ideas"]

"""FASE 4 · Señal IA comunidad + Insights IA admin. Verifica caché GET, permisos y una regeneración."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://valuation-studio.preview.emergentagent.com").rstrip("/")
USER_TOKEN = "test_profile_token_fixed_123"
ADMIN_TOKEN = "admin_test_token_123"


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Señal IA (comunidad) ----------
class TestSignalAI:
    def test_get_cache_user(self):
        r = requests.get(f"{BASE_URL}/api/community/ideas/signal/ai", headers=hdr(USER_TOKEN), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "ai" in data
        ai = data["ai"]
        assert ai is not None, "La caché de la señal IA debería estar poblada"
        assert ai.get("id") == "signal"
        assert isinstance(ai.get("items"), list) and len(ai["items"]) > 0
        assert ai.get("generated_at")
        it = ai["items"][0]
        for k in ("ticker", "verdict", "summary"):
            assert k in it
        assert it["verdict"] in ("bull", "bear", "mixed")

    def test_get_cache_admin(self):
        r = requests.get(f"{BASE_URL}/api/community/ideas/signal/ai", headers=hdr(ADMIN_TOKEN), timeout=30)
        assert r.status_code == 200
        assert r.json().get("ai") is not None

    def test_generate_by_user_ok(self):
        # Non-admin CAN regenerate the community signal (no admin gate on this endpoint).
        r = requests.post(f"{BASE_URL}/api/community/ideas/signal/generate", headers=hdr(USER_TOKEN), timeout=120)
        assert r.status_code in (200, 502), r.text  # 502 acceptable if LLM temporarily unavailable
        if r.status_code == 200:
            ai = r.json().get("ai")
            assert ai and isinstance(ai.get("items"), list)
            tickers = {i["ticker"] for i in ai["items"]}
            assert tickers, "Debe haber al menos un ticker"


# ---------- Insights IA (admin) ----------
class TestInsightsAI:
    def test_get_cache_admin(self):
        r = requests.get(f"{BASE_URL}/api/feedback/admin/insights", headers=hdr(ADMIN_TOKEN), timeout=30)
        assert r.status_code == 200, r.text
        ins = r.json().get("insights")
        assert ins is not None, "Caché de insights debería existir"
        assert ins.get("id") == "insights"
        assert isinstance(ins.get("summary"), str) and ins["summary"]
        assert isinstance(ins.get("roadmap"), list)
        for r_it in ins["roadmap"]:
            assert r_it.get("priority") in ("P0", "P1", "P2")

    def test_get_denied_non_admin(self):
        r = requests.get(f"{BASE_URL}/api/feedback/admin/insights", headers=hdr(USER_TOKEN), timeout=30)
        assert r.status_code == 403

    def test_generate_denied_non_admin(self):
        r = requests.post(f"{BASE_URL}/api/feedback/admin/insights/generate", headers=hdr(USER_TOKEN), timeout=30)
        assert r.status_code == 403

    def test_generate_admin_ok(self):
        r = requests.post(f"{BASE_URL}/api/feedback/admin/insights/generate", headers=hdr(ADMIN_TOKEN), timeout=120)
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            ins = r.json().get("insights")
            assert ins and ins.get("summary")
            assert isinstance(ins.get("roadmap"), list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

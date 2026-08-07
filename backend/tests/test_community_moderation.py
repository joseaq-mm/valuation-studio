"""Phase 3 · Community: search + report + auto-hide + admin moderation."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://valuation-studio.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

USER_TOKEN = "test_profile_token_fixed_123"
ADMIN_TOKEN = "admin_test_token_123"
REPORTER2 = "reporter_token_2"
REPORTER3 = "reporter_token_3"


def _s(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user():
    return _s(USER_TOKEN)


@pytest.fixture(scope="module")
def admin():
    return _s(ADMIN_TOKEN)


# ---------------- SEARCH ----------------
def test_search_min_length(user):
    r = user.get(f"{API}/community/search", params={"q": "a"})
    assert r.status_code in (400, 422), r.text


def test_search_returns_structure(user):
    # First create a topic to search for
    title = f"TEST_search_{uuid.uuid4().hex[:6]} valuacion fundamental"
    cr = user.post(f"{API}/community/topics", json={"scope": "general", "title": title, "body": "cuerpo de prueba busqueda"})
    assert cr.status_code == 200, cr.text
    r = user.get(f"{API}/community/search", params={"q": "valuacion"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "topics" in data and "ideas" in data and "replies" in data
    # our topic should appear
    all_ids = [t["id"] for t in data["topics"]]
    assert cr.json()["id"] in all_ids


# ---------------- REPORT + AUTO-HIDE ----------------
@pytest.fixture(scope="module")
def target_topic(user):
    title = f"TEST_report_{uuid.uuid4().hex[:6]}"
    r = user.post(f"{API}/community/topics", json={"scope": "general", "title": title, "body": "target de reporte"})
    assert r.status_code == 200
    return r.json()["id"]


def test_report_first(target_topic):
    s = _s(REPORTER2)
    r = s.post(f"{API}/community/report", json={"target_type": "topic", "target_id": target_topic, "reason": "spam"})
    assert r.status_code == 200, r.text
    assert r.json().get("reports") == 1


def test_report_dedupe_same_user(target_topic):
    s = _s(REPORTER2)
    r = s.post(f"{API}/community/report", json={"target_type": "topic", "target_id": target_topic, "reason": "again"})
    assert r.status_code == 200
    assert r.json().get("already") is True


def test_report_autohide_at_3(target_topic, user):
    # reporter3
    r2 = _s(REPORTER3).post(f"{API}/community/report", json={"target_type": "topic", "target_id": target_topic})
    assert r2.status_code == 200
    # 3rd distinct: use USER_TOKEN
    r3 = user.post(f"{API}/community/report", json={"target_type": "topic", "target_id": target_topic})
    assert r3.status_code == 200
    assert r3.json().get("reports") >= 3
    # topic should be hidden from public listing
    lr = user.get(f"{API}/community/topics", params={"scope": "general"})
    ids = [t["id"] for t in lr.json().get("topics", [])]
    assert target_topic not in ids
    # And GET single topic should 404 (hidden)
    single = user.get(f"{API}/community/topics/{target_topic}")
    assert single.status_code == 404


# ---------------- ADMIN MODERATION ----------------
def test_non_admin_cannot_moderate(user):
    r = user.get(f"{API}/community/admin/moderation")
    assert r.status_code == 403


def test_admin_lists_moderation(admin):
    r = admin.get(f"{API}/community/admin/moderation", params={"status": "open"})
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert isinstance(items, list)


def test_admin_approve_restores_visibility(admin, user, target_topic):
    # find moderation item for target_topic
    r = admin.get(f"{API}/community/admin/moderation", params={"status": "open"})
    items = r.json()["items"]
    mid = next((m["id"] for m in items if m.get("target_id") == target_topic), None)
    assert mid, f"No moderation item found for {target_topic}"
    # approve
    ar = admin.post(f"{API}/community/admin/moderation/{mid}", json={"action": "approve"})
    assert ar.status_code == 200
    # now topic should be visible again
    single = user.get(f"{API}/community/topics/{target_topic}")
    assert single.status_code == 200


def test_admin_delete_action(admin, user):
    # create a fresh topic, then delete it via mod
    title = f"TEST_delmod_{uuid.uuid4().hex[:6]}"
    cr = user.post(f"{API}/community/topics", json={"scope": "general", "title": title, "body": "para borrar"})
    tid = cr.json()["id"]
    _s(REPORTER2).post(f"{API}/community/report", json={"target_type": "topic", "target_id": tid, "reason": "x"})
    r = admin.get(f"{API}/community/admin/moderation", params={"status": "open"})
    mid = next((m["id"] for m in r.json()["items"] if m.get("target_id") == tid), None)
    assert mid
    dr = admin.post(f"{API}/community/admin/moderation/{mid}", json={"action": "delete"})
    assert dr.status_code == 200
    # target should be soft-removed
    single = user.get(f"{API}/community/topics/{tid}")
    assert single.status_code == 404


def test_ai_flag_exists_in_queue(admin):
    """Anti-manip AI flag existence: at least one item with source='ai' should exist (seeded)."""
    r = admin.get(f"{API}/community/admin/moderation", params={"status": "all"})
    assert r.status_code == 200
    items = r.json()["items"]
    ai_items = [m for m in items if m.get("source") == "ai"]
    # per test agent context: at least one seeded AI flag expected
    assert len(ai_items) >= 1, "No AI (anti-manipulation) items in moderation queue"

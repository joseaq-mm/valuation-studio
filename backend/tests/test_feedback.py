"""E2E API tests for feedback (suggestions) module.

Verifies: threads (create/list/reply), unread counts, admin filtering/search,
metadata visible to admin, admin status update, surveys create/vote/results/toggle,
non-admin 403 guards, user reply reopens resolved thread.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://valuation-studio.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

USER_TOKEN = "test_profile_token_fixed_123"
ADMIN_TOKEN = "admin_test_token_123"


def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_thread_id():
    # user creates a thread (multipart)
    r = requests.post(f"{API}/feedback/threads",
                      headers=h(USER_TOKEN),
                      data={"type": "bug", "message": f"TEST_thread {uuid.uuid4().hex[:6]} - login broken",
                            "metadata": '{"browser":"Chrome","os":"Linux","page":"/thesis"}'})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    assert isinstance(tid, str) and len(tid) > 0
    return tid


@pytest.fixture(scope="module")
def created_survey_id():
    r = requests.post(f"{API}/feedback/surveys",
                      headers=h(ADMIN_TOKEN),
                      json={"question": f"TEST_survey_q {uuid.uuid4().hex[:6]}?",
                            "options": ["Opt A", "Opt B", "Opt C"]})
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- User thread flow ----------
class TestUserThreads:
    def test_create_thread_bad_type(self):
        r = requests.post(f"{API}/feedback/threads", headers=h(USER_TOKEN),
                          data={"type": "invalid", "message": "hi"})
        assert r.status_code == 400

    def test_create_thread_empty_message(self):
        r = requests.post(f"{API}/feedback/threads", headers=h(USER_TOKEN),
                          data={"type": "bug", "message": "  "})
        assert r.status_code == 400

    def test_my_threads_lists_created(self, created_thread_id):
        r = requests.get(f"{API}/feedback/threads", headers=h(USER_TOKEN))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()["threads"]]
        assert created_thread_id in ids

    def test_my_threads_no_admin_only_fields(self, created_thread_id):
        r = requests.get(f"{API}/feedback/threads", headers=h(USER_TOKEN))
        t = next(t for t in r.json()["threads"] if t["id"] == created_thread_id)
        assert t.get("metadata") is None
        assert t.get("user_email") is None
        assert t.get("unread_for_admin") is None

    def test_get_thread_returns_messages(self, created_thread_id):
        r = requests.get(f"{API}/feedback/threads/{created_thread_id}", headers=h(USER_TOKEN))
        assert r.status_code == 200
        j = r.json()
        assert len(j["messages"]) >= 1
        assert j["messages"][0]["sender"] == "user"

    def test_get_thread_forbidden_other_user(self, created_thread_id):
        # admin CAN access; a bogus non-owner user token isn't easy — use no token → 401
        r = requests.get(f"{API}/feedback/threads/{created_thread_id}")
        assert r.status_code in (401, 403)


# ---------- Unread ----------
class TestUnread:
    def test_unread_shape_user(self):
        r = requests.get(f"{API}/feedback/unread", headers=h(USER_TOKEN))
        assert r.status_code == 200
        j = r.json()
        for k in ("user_total", "user_threads", "pending_surveys", "is_admin"):
            assert k in j
        assert j["is_admin"] is False

    def test_unread_shape_admin(self):
        r = requests.get(f"{API}/feedback/unread", headers=h(ADMIN_TOKEN))
        assert r.status_code == 200
        j = r.json()
        assert j["is_admin"] is True
        assert "admin_threads" in j


# ---------- Admin thread management ----------
class TestAdmin:
    def test_admin_list_threads(self, created_thread_id):
        r = requests.get(f"{API}/feedback/admin/threads", headers=h(ADMIN_TOKEN))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()["threads"]]
        assert created_thread_id in ids

    def test_admin_metadata_visible(self, created_thread_id):
        r = requests.get(f"{API}/feedback/admin/threads", headers=h(ADMIN_TOKEN))
        t = next(t for t in r.json()["threads"] if t["id"] == created_thread_id)
        assert t.get("metadata") is not None
        assert t["metadata"].get("browser") == "Chrome"
        assert t.get("user_email") == "profiletest@example.com"

    def test_admin_search_by_subject(self, created_thread_id):
        r = requests.get(f"{API}/feedback/admin/threads",
                         headers=h(ADMIN_TOKEN), params={"q": "login broken"})
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()["threads"]]
        assert created_thread_id in ids

    def test_admin_filter_type(self):
        r = requests.get(f"{API}/feedback/admin/threads",
                         headers=h(ADMIN_TOKEN), params={"type": "bug"})
        assert r.status_code == 200
        for t in r.json()["threads"]:
            assert t["type"] == "bug"

    def test_non_admin_forbidden(self):
        r = requests.get(f"{API}/feedback/admin/threads", headers=h(USER_TOKEN))
        assert r.status_code == 403

    def test_admin_reply_and_user_unread_increments(self, created_thread_id):
        # baseline
        before = requests.get(f"{API}/feedback/unread", headers=h(USER_TOKEN)).json()["user_threads"]
        r = requests.post(f"{API}/feedback/threads/{created_thread_id}/messages",
                          headers=h(ADMIN_TOKEN), json={"text": "TEST_admin_reply"})
        assert r.status_code == 200
        after = requests.get(f"{API}/feedback/unread", headers=h(USER_TOKEN)).json()["user_threads"]
        assert after == before + 1

    def test_user_open_thread_clears_unread(self, created_thread_id):
        r = requests.get(f"{API}/feedback/threads/{created_thread_id}", headers=h(USER_TOKEN))
        assert r.status_code == 200
        # thread's unread_for_user should be 0 in this response
        assert r.json()["thread"]["unread_for_user"] == 0

    def test_admin_set_status_resolved(self, created_thread_id):
        r = requests.patch(f"{API}/feedback/admin/threads/{created_thread_id}",
                           headers=h(ADMIN_TOKEN), json={"status": "resolved"})
        assert r.status_code == 200
        r2 = requests.get(f"{API}/feedback/threads/{created_thread_id}", headers=h(USER_TOKEN))
        assert r2.json()["thread"]["status"] == "resolved"

    def test_user_reply_reopens_resolved(self, created_thread_id):
        r = requests.post(f"{API}/feedback/threads/{created_thread_id}/messages",
                          headers=h(USER_TOKEN), json={"text": "TEST_user_reply_reopen"})
        assert r.status_code == 200
        r2 = requests.get(f"{API}/feedback/threads/{created_thread_id}", headers=h(USER_TOKEN))
        assert r2.json()["thread"]["status"] == "in_progress"

    def test_admin_bad_status(self, created_thread_id):
        r = requests.patch(f"{API}/feedback/admin/threads/{created_thread_id}",
                           headers=h(ADMIN_TOKEN), json={"status": "bogus"})
        assert r.status_code == 400


# ---------- Surveys ----------
class TestSurveys:
    def test_non_admin_create_survey_forbidden(self):
        r = requests.post(f"{API}/feedback/surveys", headers=h(USER_TOKEN),
                          json={"question": "q?", "options": ["a", "b"]})
        assert r.status_code == 403

    def test_survey_needs_two_options(self):
        r = requests.post(f"{API}/feedback/surveys", headers=h(ADMIN_TOKEN),
                          json={"question": "q?", "options": ["only"]})
        assert r.status_code == 400

    def test_list_active_surveys_user(self, created_survey_id):
        r = requests.get(f"{API}/feedback/surveys", headers=h(USER_TOKEN))
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()["surveys"]]
        assert created_survey_id in ids

    def test_user_vote_and_results_visible(self, created_survey_id):
        r = requests.post(f"{API}/feedback/surveys/{created_survey_id}/vote",
                          headers=h(USER_TOKEN), json={"option_index": 1})
        assert r.status_code == 200
        r2 = requests.get(f"{API}/feedback/surveys", headers=h(USER_TOKEN))
        s = next(x for x in r2.json()["surveys"] if x["id"] == created_survey_id)
        assert s["my_vote"] == 1
        assert "results" in s
        assert sum(s["results"]) >= 1

    def test_vote_invalid_option(self, created_survey_id):
        r = requests.post(f"{API}/feedback/surveys/{created_survey_id}/vote",
                          headers=h(USER_TOKEN), json={"option_index": 99})
        assert r.status_code == 400

    def test_admin_toggle_survey(self, created_survey_id):
        r = requests.patch(f"{API}/feedback/surveys/{created_survey_id}",
                           headers=h(ADMIN_TOKEN), json={"active": False})
        assert r.status_code == 200
        # user list should NOT include it now (only active)
        r2 = requests.get(f"{API}/feedback/surveys", headers=h(USER_TOKEN))
        ids = [s["id"] for s in r2.json()["surveys"]]
        assert created_survey_id not in ids

    def test_non_admin_toggle_forbidden(self, created_survey_id):
        r = requests.patch(f"{API}/feedback/surveys/{created_survey_id}",
                           headers=h(USER_TOKEN), json={"active": True})
        assert r.status_code == 403

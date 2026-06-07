"""Unit tests for prune_stale_split_dev: deleting a developed (sub)thesis must
drop its split_dev entry so the origin company shows the core/split as pending."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes.thesis import prune_stale_split_dev  # noqa: E402


def _sd():
    return [
        {"core": "Lípidos y colesterol", "split": None, "developed_id": "dev_alive", "whole": True},
        {"core": "Hipertensión", "split": "Renal", "developed_id": "dev_deleted", "whole": False},
    ]


def test_drops_entry_whose_developed_thesis_was_deleted():
    out = prune_stale_split_dev(_sd(), {"dev_alive"})
    assert len(out) == 1
    assert out[0]["developed_id"] == "dev_alive"


def test_keeps_all_when_every_developed_thesis_alive():
    out = prune_stale_split_dev(_sd(), {"dev_alive", "dev_deleted"})
    assert len(out) == 2


def test_drops_all_when_none_alive():
    assert prune_stale_split_dev(_sd(), set()) == []


def test_empty_and_none_inputs():
    assert prune_stale_split_dev(None, {"x"}) == []
    assert prune_stale_split_dev([], {"x"}) == []


def test_is_idempotent_and_order_preserving():
    sd = _sd()
    once = prune_stale_split_dev(sd, {"dev_alive"})
    twice = prune_stale_split_dev(once, {"dev_alive"})
    assert once == twice
    assert [e["developed_id"] for e in once] == ["dev_alive"]

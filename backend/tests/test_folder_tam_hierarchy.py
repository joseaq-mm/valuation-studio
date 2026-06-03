"""Unit tests for TAM hierarchy aggregation (no double-counting of child theses)."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.thesis import aggregate_folder_tam  # noqa: E402


def test_excludes_child_tam():
    trends = [
        {"tam_busd": 700, "is_child": False},  # mother
        {"tam_busd": 450, "is_child": True},   # child (subset) → excluded
    ]
    assert aggregate_folder_tam(trends) == 700.0


def test_sums_independent_trends():
    trends = [
        {"tam_busd": 300, "is_child": False},
        {"tam_busd": 200, "is_child": False},
    ]
    assert aggregate_folder_tam(trends) == 500.0


def test_all_children_returns_none():
    trends = [
        {"tam_busd": 100, "is_child": True},
        {"tam_busd": 50, "is_child": True},
    ]
    assert aggregate_folder_tam(trends) is None


def test_handles_missing_tam():
    trends = [
        {"tam_busd": None, "is_child": False},
        {"tam_busd": 120, "is_child": False},
    ]
    assert aggregate_folder_tam(trends) == 120.0


def test_empty_returns_none():
    assert aggregate_folder_tam([]) is None

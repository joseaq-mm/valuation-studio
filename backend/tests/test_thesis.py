"""Regression tests for the Thesis Engine pure helpers (no LLM / network)."""
from services.thesis import _extract_json, _clamp_score, _sources_block, compute_tam_score


def test_extract_json_plain():
    assert _extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_fenced():
    txt = '```json\n{"ticker": "NVDA", "scores": {"x": 90}}\n```'
    assert _extract_json(txt)["ticker"] == "NVDA"


def test_extract_json_with_prose():
    txt = 'Aquí tienes el JSON:\n{"companies": [{"ticker": "MSFT"}]}\nFin.'
    out = _extract_json(txt)
    assert out["companies"][0]["ticker"] == "MSFT"


def test_extract_json_garbage():
    assert _extract_json("no json here") == {}
    assert _extract_json("") == {}


def test_clamp_score():
    assert _clamp_score(150) == 100
    assert _clamp_score(-5) == 0
    assert _clamp_score(73.6) == 74
    assert _clamp_score(None) is None
    assert _clamp_score("abc") is None


def test_sources_block_empty():
    assert "no live results" in _sources_block([])


def test_sources_block_formats():
    s = _sources_block([{"title": "T", "url": "http://x", "snippet": "snip"}])
    assert "[1]" in s and "http://x" in s


def test_compute_tam_score_basic():
    # (90/100 * 500) / 821.51 = 0.5478 -> 0.55
    assert compute_tam_score(90, 500, 821.51) == 0.55
    # (80/100 * 796) / 147.18 = 4.326 -> 4.33
    assert compute_tam_score(80, 796, 147.18) == 4.33


def test_compute_tam_score_missing_inputs():
    assert compute_tam_score(None, 500, 100) is None
    assert compute_tam_score(90, None, 100) is None
    assert compute_tam_score(90, 500, None) is None


def test_compute_tam_score_non_positive_revenue():
    assert compute_tam_score(90, 500, 0) is None
    assert compute_tam_score(90, 500, -10) is None


def test_compute_tam_score_bad_types():
    assert compute_tam_score("x", 500, 100) is None
    assert compute_tam_score(90, "y", 100) is None

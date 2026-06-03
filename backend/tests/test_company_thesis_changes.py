"""Unit tests for the company-thesis novelty comparator (_company_thesis_changes)."""
from routes.thesis import _company_thesis_changes


def _doc(trends, overall=90, prob=7):
    return {"overall_relevance": overall, "probability": prob, "trends": trends}


def test_identical_no_changes():
    t = [{"name": "IA y centros de datos", "relevance_score": 90, "win_probability": 8}]
    assert _company_thesis_changes(_doc(t), _doc(list(t))) == []


def test_reworded_trend_within_tolerance_no_changes():
    old = _doc([{"name": "Inteligencia artificial y centros de datos", "relevance_score": 90, "win_probability": 8}])
    # reworded name (high token overlap) + scores within tolerance → no relevant novelty
    new = _doc([{"name": "Inteligencia artificial y centros de datos modernos", "relevance_score": 93, "win_probability": 8}])
    assert _company_thesis_changes(old, new) == []


def test_score_change_detected():
    old = _doc([{"name": "IA y centros de datos", "relevance_score": 80, "win_probability": 6}])
    new = _doc([{"name": "IA y centros de datos", "relevance_score": 95, "win_probability": 9}])
    changes = _company_thesis_changes(old, new)
    assert any("Relevancia de" in c for c in changes)
    assert any("Probabilidad ganadora" in c for c in changes)


def test_new_and_removed_trends():
    old = _doc([{"name": "Robótica física", "relevance_score": 70, "win_probability": 5}])
    new = _doc([{"name": "Ciberseguridad empresarial", "relevance_score": 80, "win_probability": 7}])
    changes = _company_thesis_changes(old, new)
    assert any(c.startswith("Nueva tendencia:") for c in changes)
    assert any(c.startswith("Tendencia eliminada:") for c in changes)


def test_overall_metrics_change_detected():
    t = [{"name": "IA y centros de datos", "relevance_score": 90, "win_probability": 8}]
    changes = _company_thesis_changes(_doc(t, overall=80, prob=6), _doc(list(t), overall=95, prob=9))
    assert any("Relevancia temática global" in c for c in changes)
    assert any("Probabilidad de la tesis" in c for c in changes)

"""Unit tests for stage_tam_for_role: a company whose value_chain_role spans
several stages (joined text) must still resolve a stage TAM (sum of matched
stages), so the TAM Score is not silently None."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.thesis import stage_tam_for_role  # noqa: E402

VC = [
    {"stage": "Diagnóstico y Monitoreo de Lípidos", "tam_busd": 1.5},
    {"stage": "Terapias Orales Estándar", "tam_busd": 20.0},
    {"stage": "Terapias Biológicas e Inyectables Avanzadas", "tam_busd": 17.0},
]


def test_exact_single_stage_match():
    assert stage_tam_for_role("Terapias Orales Estándar", VC) == 20.0


def test_multi_stage_role_sums_matched_stages():
    role = "Diagnóstico y Monitoreo de Lípidos; Terapias Orales Estándar"
    assert stage_tam_for_role(role, VC) == 21.5


def test_no_match_returns_none():
    assert stage_tam_for_role("Algo Inexistente", VC) is None


def test_empty_inputs():
    assert stage_tam_for_role("", VC) is None
    assert stage_tam_for_role("Terapias Orales Estándar", []) is None
    assert stage_tam_for_role(None, VC) is None


def test_case_insensitive():
    assert stage_tam_for_role("terapias orales estándar", VC) == 20.0

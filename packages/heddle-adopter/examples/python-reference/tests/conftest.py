from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

SPEC_ROOT = Path(__file__).resolve().parents[1] / ".." / ".." / "spec" / "v1"
FIXTURE_ROOT = SPEC_ROOT / "fixtures"


@pytest.fixture
def authority_fixture() -> dict[str, Any]:
    return read_json(FIXTURE_ROOT / "authority.json")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[4]
SPEC_ROOT = PACKAGE_ROOT / "spec" / "v1"
FIXTURE_ROOT = SPEC_ROOT / "fixtures"


@pytest.fixture
def authority_fixture() -> dict[str, Any]:
    return read_json(FIXTURE_ROOT / "authority.json")


@pytest.fixture
def lifecycle_fixture() -> dict[str, Any]:
    return read_json(FIXTURE_ROOT / "durable-conversation-lifecycle.json")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))

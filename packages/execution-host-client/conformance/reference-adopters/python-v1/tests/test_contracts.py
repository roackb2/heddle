from __future__ import annotations

import json

import pytest
from conftest import FIXTURE_ROOT, SPEC_ROOT
from jsonschema import ValidationError

from heddle_adopter_reference.contracts import ContractBundle


def test_checked_in_schema_accepts_only_the_authority_free_request() -> None:
    contract = ContractBundle.load(SPEC_ROOT / "schema-bundle.json")
    valid = json.loads((FIXTURE_ROOT / "valid-request.json").read_text(encoding="utf-8"))
    invalid = json.loads(
        (FIXTURE_ROOT / "invalid-request-extra-field.json").read_text(encoding="utf-8")
    )

    contract.validate("ConversationTurnRequest", valid)
    with pytest.raises(ValidationError):
        contract.validate("ConversationTurnRequest", invalid)


def test_schema_bundle_validates_stream_and_authority_examples(
    authority_fixture: dict[str, object],
) -> None:
    contract = ContractBundle.load(SPEC_ROOT / "schema-bundle.json")
    contract.validate(
        "ExecutionAssertionClaims",
        authority_fixture["expected"]["executionClaims"],  # type: ignore[index]
    )
    contract.validate(
        "McpCapabilityClaims",
        authority_fixture["expected"]["mcpClaims"],  # type: ignore[index]
    )

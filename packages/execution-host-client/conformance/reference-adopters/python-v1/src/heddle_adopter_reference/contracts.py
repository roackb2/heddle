"""Shared v1 validation primitives backed by the versioned JSON Schema."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker

EXECUTION_CONTRACT_VERSION = 1
CONVERSATION_TURN_WORKFLOW = "conversation-turn"
HEARTBEAT_TASK_WORKFLOW = "heartbeat-task"
SUPPORTED_EXECUTION_WORKFLOWS = frozenset({CONVERSATION_TURN_WORKFLOW, HEARTBEAT_TASK_WORKFLOW})
EXECUTION_ASSERTION_TYPE = "heddle-execution+jwt"
MCP_CAPABILITY_TYPE = "heddle-mcp-capability+jwt"

AGENTCORE_RUNTIME_SESSION_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"
EXECUTION_HOST_LOCAL_TOKEN_HEADER = "x-heddle-execution-host-local-token"
EXECUTION_ASSERTION_HEADER = "x-heddle-execution-host-assertion"
MCP_CAPABILITY_HEADER = "x-heddle-execution-host-mcp-capability"
MODEL_API_KEY_HEADER = "x-heddle-execution-host-model-api-key"

_OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@-]*$")
_MCP_SERVER_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_MCP_TOOL_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class ExecutionScope:
    """Product-authorized identity selected by the adopter backend."""

    tenant_id: str
    subject_id: str
    product_session_id: str

    def __post_init__(self) -> None:
        validate_opaque_id(self.tenant_id)
        validate_opaque_id(self.subject_id)
        validate_opaque_id(self.product_session_id)


class ContractBundle:
    """Loads one versioned schema bundle and validates named definitions."""

    def __init__(self, bundle: Mapping[str, Any]) -> None:
        self._bundle = dict(bundle)
        Draft202012Validator.check_schema(self._bundle)

    @classmethod
    def load(cls, path: Path) -> ContractBundle:
        import json

        return cls(json.loads(path.read_text(encoding="utf-8")))

    def validate(self, definition: str, value: Any) -> None:
        definitions = self._bundle.get("$defs")
        if not isinstance(definitions, dict) or definition not in definitions:
            raise KeyError(f"Unknown contract definition: {definition}")
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$defs": definitions,
            "$ref": f"#/$defs/{definition}",
        }
        Draft202012Validator(
            schema,
            format_checker=FormatChecker(),
        ).validate(value)


def validate_opaque_id(value: str) -> str:
    if not 1 <= len(value) <= 128 or not _OPAQUE_ID.fullmatch(value):
        raise ValueError("Expected an opaque, path-free identifier.")
    return value


def validate_runtime_session_id(value: str) -> str:
    if not 33 <= len(value) <= 256 or value != value.strip():
        raise ValueError("Expected a trimmed runtime session identifier.")
    return value


def validate_timestamp(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise ValueError("Expected an ISO timestamp with an offset.") from error
    if parsed.tzinfo is None:
        raise ValueError("Expected an ISO timestamp with an offset.")
    return value


def validate_mcp_server_id(value: str) -> str:
    if not 1 <= len(value) <= 64 or not _MCP_SERVER_ID.fullmatch(value):
        raise ValueError("Expected a Heddle-compatible MCP server identifier.")
    return value


def validate_allowed_tools(tools: Sequence[str]) -> tuple[str, ...]:
    values = tuple(tools)
    valid_names = all(
        isinstance(tool, str) and 1 <= len(tool) <= 64 and _MCP_TOOL_NAME.fullmatch(tool)
        for tool in values
    )
    if (
        not 1 <= len(values) <= 16
        or not valid_names
        or len(set(values)) != len(values)
        or sum(map(len, values)) > 512
    ):
        raise ValueError("Expected a bounded unique MCP tool allowlist.")
    return values


def validate_safe_web_url(value: str, *, allow_loopback_http: bool = True) -> str:
    parsed = urlsplit(value)
    loopback = parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    safe_scheme = parsed.scheme == "https" or (
        allow_loopback_http and parsed.scheme == "http" and loopback
    )
    if (
        not safe_scheme
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Expected HTTPS or loopback HTTP without URL credentials or metadata.")
    return value

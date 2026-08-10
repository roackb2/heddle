"""Strict direct HTTP/SSE client for the v1 Execution Host wire."""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
from httpx_sse import SSEError, aconnect_sse

from .contracts import (
    AGENTCORE_RUNTIME_SESSION_HEADER,
    CONVERSATION_TURN_WORKFLOW,
    EXECUTION_ASSERTION_HEADER,
    EXECUTION_CONTRACT_VERSION,
    EXECUTION_HOST_LOCAL_TOKEN_HEADER,
    MCP_CAPABILITY_HEADER,
    MODEL_API_KEY_HEADER,
    validate_opaque_id,
    validate_runtime_session_id,
    validate_safe_web_url,
)
from .errors import (
    ExecutionHostProtocolError,
    ExecutionHostRejectedError,
    ExecutionHostStreamInterruptedError,
)

_MAX_SSE_DATA_CHARACTERS = 1_048_576
_MAX_ERROR_BODY_BYTES = 16_384
_ERROR_CODE = re.compile(r"^[a-z0-9_]+$")
_TERMINAL_KINDS = frozenset({"result", "cancelled", "error"})


@dataclass(frozen=True)
class ExecutionHostConversationTurn:
    invocation_id: str
    runtime_session_id: str
    prompt: str
    execution_assertion: str = field(repr=False)
    model_api_key: str = field(repr=False)
    mcp_capability: str | None = field(default=None, repr=False)
    deadline_at: str | None = None

    def __post_init__(self) -> None:
        validate_opaque_id(self.invocation_id)
        validate_runtime_session_id(self.runtime_session_id)
        prompt = self.prompt.strip()
        if not 1 <= len(prompt) <= 200_000:
            raise ValueError("Expected a non-empty bounded prompt.")
        object.__setattr__(self, "prompt", prompt)
        _validate_secret(self.execution_assertion, minimum=32)
        _validate_secret(self.model_api_key, minimum=8)
        if self.mcp_capability is not None:
            _validate_secret(self.mcp_capability, minimum=32)
        if self.deadline_at is not None:
            parsed = datetime.fromisoformat(self.deadline_at.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("Execution deadline must contain an offset.")


class DirectHttpExecutionHost:
    """Reference direct-development client; it deliberately has no AWS SDK."""

    __slots__ = ("_client", "_endpoint", "_owns_client", "__local_token")

    def __init__(
        self,
        base_url: str,
        local_token: str,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        validate_safe_web_url(base_url)
        _validate_secret(local_token, minimum=8)
        self._endpoint = f"{base_url.rstrip('/')}/invocations"
        self.__local_token = local_token
        self._client = client or httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(connect=10, read=None, write=30, pool=5),
        )
        self._owns_client = client is None

    async def stream_conversation_turn(
        self,
        turn: ExecutionHostConversationTurn,
    ) -> AsyncIterator[Mapping[str, Any]]:
        body: dict[str, Any] = {
            "schemaVersion": EXECUTION_CONTRACT_VERSION,
            "kind": CONVERSATION_TURN_WORKFLOW,
            "invocationId": turn.invocation_id,
            "prompt": turn.prompt,
        }
        if turn.deadline_at is not None:
            body["deadlineAt"] = turn.deadline_at
        headers = {
            "Content-Type": "application/json",
            AGENTCORE_RUNTIME_SESSION_HEADER: turn.runtime_session_id,
            EXECUTION_HOST_LOCAL_TOKEN_HEADER: self.__local_token,
            EXECUTION_ASSERTION_HEADER: turn.execution_assertion,
            MODEL_API_KEY_HEADER: turn.model_api_key,
        }
        if turn.mcp_capability is not None:
            headers[MCP_CAPABILITY_HEADER] = turn.mcp_capability

        state = _StreamState(invocation_id=turn.invocation_id)
        terminal: Mapping[str, Any] | None = None
        try:
            async with aconnect_sse(
                self._client,
                "POST",
                self._endpoint,
                headers=headers,
                json=body,
                follow_redirects=False,
            ) as source:
                if not source.response.is_success:
                    raise ExecutionHostRejectedError(
                        source.response.status_code,
                        await _read_safe_error_code(source.response),
                    )
                async for frame in source.aiter_sse():
                    if len(frame.data) > _MAX_SSE_DATA_CHARACTERS:
                        raise ExecutionHostProtocolError()
                    event = _validate_event(
                        event_name=frame.event,
                        event_id=frame.id,
                        data=frame.data,
                        state=state,
                    )
                    if event["kind"] in _TERMINAL_KINDS:
                        terminal = event
                    else:
                        yield event
        except (ExecutionHostProtocolError, ExecutionHostRejectedError):
            raise
        except SSEError as error:
            raise ExecutionHostProtocolError() from error
        except httpx.HTTPError as error:
            raise ExecutionHostStreamInterruptedError() from error

        if not state.accepted:
            raise ExecutionHostProtocolError("Execution Host stream omitted accepted.")
        if terminal is None or not state.terminal:
            raise ExecutionHostStreamInterruptedError()
        # Do not release success until the HTTP body reaches a clean EOF.
        yield terminal

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> DirectHttpExecutionHost:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    def __repr__(self) -> str:
        return f"DirectHttpExecutionHost(endpoint={self._endpoint!r})"


@dataclass
class _StreamState:
    invocation_id: str
    run_id: str | None = None
    next_sequence: int = 0
    accepted: bool = False
    terminal: bool = False


def _validate_event(
    *,
    event_name: str,
    event_id: str,
    data: str,
    state: _StreamState,
) -> Mapping[str, Any]:
    try:
        decoded = json.loads(data)
    except (TypeError, json.JSONDecodeError) as error:
        raise ExecutionHostProtocolError() from error
    if not isinstance(decoded, dict):
        raise ExecutionHostProtocolError()

    common_keys = {
        "schemaVersion",
        "invocationId",
        "runId",
        "sequence",
        "timestamp",
        "kind",
    }
    kind = decoded.get("kind")
    expected_keys = {
        "accepted": common_keys,
        "activity": common_keys | {"activity"},
        "result": common_keys | {"result"},
        "cancelled": common_keys | {"reason"},
        "error": common_keys | {"error"},
    }.get(kind)
    if expected_keys is None or set(decoded) != expected_keys:
        raise ExecutionHostProtocolError()

    sequence = decoded.get("sequence")
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
        raise ExecutionHostProtocolError()
    if (
        decoded.get("schemaVersion") != EXECUTION_CONTRACT_VERSION
        or decoded.get("invocationId") != state.invocation_id
        or event_name != kind
        or event_id != str(sequence)
        or sequence != state.next_sequence
        or state.terminal
    ):
        raise ExecutionHostProtocolError()
    validate_opaque_id(_required_string(decoded, "invocationId"))
    run_id = validate_opaque_id(_required_string(decoded, "runId"))
    _validate_timestamp(_required_string(decoded, "timestamp"))

    if not state.accepted:
        if kind != "accepted" or sequence != 0:
            raise ExecutionHostProtocolError()
        state.accepted = True
        state.run_id = run_id
    elif kind == "accepted" or run_id != state.run_id:
        raise ExecutionHostProtocolError()

    if kind == "result":
        _validate_result(decoded["result"])
    elif kind == "cancelled":
        _required_string(decoded, "reason")
    elif kind == "error":
        _validate_error_event(decoded["error"])

    state.next_sequence += 1
    state.terminal = kind in _TERMINAL_KINDS
    return decoded


def _validate_result(value: Any) -> None:
    if not isinstance(value, dict):
        raise ExecutionHostProtocolError()
    allowed = {"outcome", "summary", "failure"}
    if not set(value).issubset(allowed) or value.get("outcome") not in {
        "done",
        "max_steps",
        "error",
        "interrupted",
    }:
        raise ExecutionHostProtocolError()
    if "summary" in value and not isinstance(value["summary"], str):
        raise ExecutionHostProtocolError()
    if "failure" in value:
        failure = value["failure"]
        valid_codes = {
            "authentication",
            "permission",
            "quota",
            "rate_limit",
            "context_window",
            "request",
            "transport",
            "empty_response",
            "unknown",
        }
        if (
            not isinstance(failure, dict)
            or set(failure) != {"source", "code"}
            or failure.get("source") != "model"
            or failure.get("code") not in valid_codes
        ):
            raise ExecutionHostProtocolError()


def _validate_error_event(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"code", "message"}:
        raise ExecutionHostProtocolError()
    code = value.get("code")
    message = value.get("message")
    if (
        not isinstance(code, str)
        or not 1 <= len(code) <= 128
        or not _ERROR_CODE.fullmatch(code)
        or not isinstance(message, str)
        or not 1 <= len(message) <= 1_600
    ):
        raise ExecutionHostProtocolError()


async def _read_safe_error_code(response: httpx.Response) -> str:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > _MAX_ERROR_BODY_BYTES:
            return "unknown"
    try:
        decoded = json.loads(body)
        error = decoded["error"]
        code = error["code"]
        if (
            isinstance(decoded, dict)
            and set(decoded) == {"error"}
            and isinstance(error, dict)
            and set(error) == {"code", "message"}
            and isinstance(code, str)
            and 1 <= len(code) <= 128
            and _ERROR_CODE.fullmatch(code)
        ):
            return code
    except (KeyError, TypeError, json.JSONDecodeError):
        pass
    return "unknown"


def _required_string(value: Mapping[str, Any], name: str) -> str:
    item = value.get(name)
    if not isinstance(item, str):
        raise ExecutionHostProtocolError()
    return item


def _validate_timestamp(value: str) -> None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ExecutionHostProtocolError() from error
    if parsed.tzinfo is None:
        raise ExecutionHostProtocolError()


def _validate_secret(value: str, *, minimum: int) -> None:
    if not isinstance(value, str) or not minimum <= len(value) <= 4_096:
        raise ValueError("Expected a bounded credential.")

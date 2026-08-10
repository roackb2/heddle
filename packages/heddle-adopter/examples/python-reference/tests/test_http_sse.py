from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
import pytest
from conftest import FIXTURE_ROOT

from heddle_adopter_reference.contracts import (
    EXECUTION_ASSERTION_HEADER,
    MCP_CAPABILITY_HEADER,
    MODEL_API_KEY_HEADER,
)
from heddle_adopter_reference.errors import (
    ExecutionHostProtocolError,
    ExecutionHostRejectedError,
    ExecutionHostStreamInterruptedError,
)
from heddle_adopter_reference.http_sse import (
    DirectHttpExecutionHost,
    ExecutionHostConversationTurn,
)


def _turn() -> ExecutionHostConversationTurn:
    return ExecutionHostConversationTurn(
        invocation_id="invocation-001",
        runtime_session_id=f"runtime-session:{'a' * 40}",
        prompt="Summarize the current product state.",
        execution_assertion="execution-assertion".ljust(32, "x"),
        mcp_capability="mcp-capability".ljust(32, "x"),
        model_api_key="model-api-key",
    )


async def _collect(events: AsyncIterator[dict[str, object]]) -> list[dict[str, object]]:
    return [event async for event in events]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fixture_name", "expected_kinds"),
    [
        ("valid-result.sse", ["accepted", "activity", "result"]),
        ("cancelled.sse", ["accepted", "cancelled"]),
    ],
)
async def test_consumes_complete_golden_streams(
    fixture_name: str,
    expected_kinds: list[str],
) -> None:
    captured: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=(FIXTURE_ROOT / fixture_name).read_bytes(),
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    host = DirectHttpExecutionHost(
        "http://127.0.0.1:8080",
        "local-runtime-token",
        client=client,
    )
    events = await _collect(host.stream_conversation_turn(_turn()))
    await client.aclose()

    assert [event["kind"] for event in events] == expected_kinds
    request = captured[0]
    body = json.loads(request.content)
    assert body == {
        "schemaVersion": 1,
        "kind": "conversation-turn",
        "invocationId": "invocation-001",
        "prompt": "Summarize the current product state.",
    }
    assert _turn().execution_assertion not in request.content.decode()
    assert request.headers[EXECUTION_ASSERTION_HEADER] == _turn().execution_assertion
    assert request.headers[MCP_CAPABILITY_HEADER] == _turn().mcp_capability
    assert request.headers[MODEL_API_KEY_HEADER] == _turn().model_api_key
    assert _turn().model_api_key not in repr(_turn())
    assert "local-runtime-token" not in repr(host)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fixture_name", "error_type"),
    [
        ("ambiguous-eof.sse", ExecutionHostStreamInterruptedError),
        ("invalid-sequence-gap.sse", ExecutionHostProtocolError),
    ],
)
async def test_never_infers_success_from_incomplete_or_invalid_streams(
    fixture_name: str,
    error_type: type[Exception],
) -> None:
    async def handle(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=(FIXTURE_ROOT / fixture_name).read_bytes(),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        host = DirectHttpExecutionHost(
            "http://127.0.0.1:8080",
            "local-runtime-token",
            client=client,
        )
        with pytest.raises(error_type):
            await _collect(host.stream_conversation_turn(_turn()))


@pytest.mark.asyncio
async def test_rejected_response_projects_only_a_safe_error_code() -> None:
    def handle(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": {"code": "invalid_execution_assertion", "message": "private"}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        host = DirectHttpExecutionHost(
            "http://127.0.0.1:8080",
            "local-runtime-token",
            client=client,
        )
        with pytest.raises(ExecutionHostRejectedError) as raised:
            await _collect(host.stream_conversation_turn(_turn()))
    assert raised.value.status_code == 401
    assert raised.value.code == "invalid_execution_assertion"
    assert "private" not in str(raised.value)

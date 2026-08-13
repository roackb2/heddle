from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

import pytest

from heddle_adopter_reference import ExecutionScope
from heddle_adopter_reference.errors import (
    ExecutionHostInvocationCancelledError,
    ExecutionHostProtocolError,
    ExecutionHostRejectedError,
    ExecutionHostStreamInterruptedError,
)
from heddle_adopter_reference.lifecycle import (
    DurableHostedConversationTurnService,
    HostedConversationAcceptedTurn,
    HostedConversationExpiredTurnReconciliation,
    HostedConversationRequestedTurn,
    HostedConversationTerminalOutcome,
    HostedConversationTurnInput,
    HostedConversationTurnSettlement,
    interrupt_expired_hosted_conversation_turns,
    project_hosted_conversation_terminal_event,
)

REQUESTED_AT = "2026-08-14T00:00:00.000Z"
ACCEPTED_AT = "2026-08-14T00:00:01.000Z"
SETTLED_AT = "2026-08-14T00:00:02.000Z"


def test_projects_every_terminal_from_the_shared_fixture(
    lifecycle_fixture: dict[str, Any],
) -> None:
    for case in lifecycle_fixture["terminalProjectionCases"]:
        projection = project_hosted_conversation_terminal_event(
            case["event"],
            max_summary_characters=case["maxSummaryCharacters"],
        )

        assert projection.event == case["expectedEvent"], case["id"]
        assert _outcome_dict(projection.settlement) == case["expectedSettlement"], case["id"]


@pytest.mark.asyncio
async def test_persists_each_checkpoint_before_releasing_its_event() -> None:
    order: list[str] = []
    store = RecordingStore(order)
    service = _service(
        StreamRunner([_accepted(), _result("done", "Durable answer.")], order=order),
        store,
    )
    iterator = service.stream_turn(_turn())

    assert await anext(iterator) == _accepted()
    assert order == ["store requested", "runner started", "store accepted"]

    assert await anext(iterator) == _result("done", "Durable answer.")
    assert order == [
        "store requested",
        "runner started",
        "store accepted",
        "runner resumed",
        "store settled",
    ]
    with pytest.raises(StopAsyncIteration):
        await anext(iterator)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "status", "failure_code"),
    [
        (ExecutionHostStreamInterruptedError(), "interrupted", "stream_interrupted"),
        (ExecutionHostInvocationCancelledError(), "interrupted", "invocation_aborted"),
        (ExecutionHostProtocolError(), "failed", "host_protocol_error"),
        (ExecutionHostRejectedError(503, "private_code"), "failed", "host_rejected"),
        (RuntimeError("private detail"), "failed", "execution_failed"),
    ],
)
async def test_maps_thrown_failures_without_persisting_raw_details(
    error: Exception,
    status: str,
    failure_code: str,
) -> None:
    store = RecordingStore()
    service = _service(StreamRunner([_accepted()], error=error), store)

    with pytest.raises(type(error)) as raised:
        await _collect(service.stream_turn(_turn()))
    assert raised.value is error
    assert store.settlements[-1].status == status
    assert store.settlements[-1].failure_code == failure_code
    assert "private" not in repr(store.settlements[-1])


@pytest.mark.asyncio
async def test_records_task_cancellation_as_interruption_and_reraises() -> None:
    store = RecordingStore()
    service = _service(
        StreamRunner([_accepted()], error=asyncio.CancelledError()),
        store,
    )

    with pytest.raises(asyncio.CancelledError):
        await _collect(service.stream_turn(_turn()))
    assert store.settlements[-1].status == "interrupted"
    assert store.settlements[-1].failure_code == "invocation_aborted"


@pytest.mark.asyncio
async def test_records_clean_eof_and_consumer_close_as_ambiguous_interruption() -> None:
    eof_store = RecordingStore()
    eof_events = await _collect(
        _service(StreamRunner([_accepted()]), eof_store).stream_turn(_turn())
    )
    assert eof_events == [_accepted()]
    assert eof_store.settlements[-1].failure_code == "stream_ended_without_terminal"

    close_store = RecordingStore()
    iterator = _service(
        StreamRunner([_accepted(), _activity()]),
        close_store,
    ).stream_turn(_turn())
    assert await anext(iterator) == _accepted()
    await iterator.aclose()
    assert close_store.settlements[-1].status == "interrupted"
    assert close_store.settlements[-1].failure_code == "stream_ended_without_terminal"


@pytest.mark.asyncio
async def test_rejects_a_runner_that_omits_accepted() -> None:
    store = RecordingStore()
    service = _service(StreamRunner([]), store)

    with pytest.raises(ExecutionHostProtocolError):
        await _collect(service.stream_turn(_turn()))
    assert store.settlements[-1].status == "failed"
    assert store.settlements[-1].failure_code == "host_protocol_error"


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["accepted", "settled"])
async def test_fails_closed_when_a_checkpoint_write_fails(phase: str) -> None:
    store = RecordingStore()
    store.reject_phase = phase
    iterator = _service(
        StreamRunner([_accepted(), _result("done", "Must not escape.")]),
        store,
    ).stream_turn(_turn())

    if phase == "settled":
        assert (await anext(iterator))["kind"] == "accepted"
    with pytest.raises(RuntimeError, match=f"store {phase} failed"):
        await anext(iterator)


@pytest.mark.asyncio
async def test_reconciles_one_authorized_scope_with_configured_grace() -> None:
    store = RecordingStore()
    await interrupt_expired_hosted_conversation_turns(
        store,
        _turn().scope,
        expired_turn_grace_ms=45_000,
        now=lambda: datetime(2026, 8, 14, tzinfo=UTC),
    )

    assert store.reconciliations == [
        HostedConversationExpiredTurnReconciliation(
            scope=_turn().scope,
            expired_before="2026-08-13T23:59:15.000Z",
            settled_at=REQUESTED_AT,
        )
    ]


class StreamRunner:
    def __init__(
        self,
        events: list[Mapping[str, Any]],
        *,
        error: BaseException | None = None,
        order: list[str] | None = None,
    ) -> None:
        self._events = events
        self._error = error
        self._order = order

    async def stream_turn(
        self,
        _turn: HostedConversationTurnInput,
    ) -> AsyncIterator[Mapping[str, Any]]:
        if self._order is not None:
            self._order.append("runner started")
        for index, event in enumerate(self._events):
            if index > 0 and self._order is not None:
                self._order.append("runner resumed")
            yield event
        if self._error is not None:
            raise self._error


class RecordingStore:
    def __init__(self, order: list[str] | None = None) -> None:
        self.order = order if order is not None else []
        self.requested: list[HostedConversationRequestedTurn] = []
        self.accepted: list[HostedConversationAcceptedTurn] = []
        self.settlements: list[HostedConversationTurnSettlement] = []
        self.reconciliations: list[HostedConversationExpiredTurnReconciliation] = []
        self.reject_phase: str | None = None

    async def create_turn(self, turn: HostedConversationRequestedTurn) -> None:
        self.order.append("store requested")
        self.requested.append(turn)

    async def record_accepted(self, turn: HostedConversationAcceptedTurn) -> None:
        self.order.append("store accepted")
        if self.reject_phase == "accepted":
            raise RuntimeError("store accepted failed")
        self.accepted.append(turn)

    async def settle_turn(self, settlement: HostedConversationTurnSettlement) -> None:
        self.order.append("store settled")
        self.settlements.append(settlement)
        if self.reject_phase == "settled":
            raise RuntimeError("store settled failed")

    async def interrupt_expired_turns(
        self,
        reconciliation: HostedConversationExpiredTurnReconciliation,
    ) -> None:
        self.reconciliations.append(reconciliation)


def _service(
    turns: StreamRunner,
    store: RecordingStore,
) -> DurableHostedConversationTurnService:
    return DurableHostedConversationTurnService(
        turns,
        store,
        now=lambda: datetime(2026, 8, 14, tzinfo=UTC),
    )


def _turn() -> HostedConversationTurnInput:
    return HostedConversationTurnInput(
        scope=ExecutionScope(
            tenant_id="tenant-a",
            subject_id="subject-a",
            product_session_id="product-session-a",
        ),
        runtime_session_id="runtime-session-001-abcdefghijklmnop",
        invocation_id="lifecycle-invocation-001",
        prompt="Summarize my workspace.",
        deadline_at="2026-08-14T00:05:00.000Z",
    )


def _accepted() -> dict[str, Any]:
    return _event(0, "accepted")


def _activity() -> dict[str, Any]:
    return _event(1, "activity", activity={"type": "assistant_text_delta"})


def _result(outcome: str, summary: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"outcome": outcome}
    if summary is not None:
        result["summary"] = summary
    return _event(1, "result", result=result)


def _event(sequence: int, kind: str, **body: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "invocationId": "lifecycle-invocation-001",
        "runId": "lifecycle-run-001",
        "sequence": sequence,
        "timestamp": ACCEPTED_AT if kind == "accepted" else SETTLED_AT,
        "kind": kind,
        **body,
    }


def _outcome_dict(outcome: HostedConversationTerminalOutcome) -> dict[str, Any]:
    values = asdict(outcome)
    result = {"status": values["status"]}
    if values["summary"] is not None:
        result["summary"] = values["summary"]
    if values["failure_code"] is not None:
        result["failureCode"] = values["failure_code"]
    return result


async def _collect(
    events: AsyncIterator[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    return [event async for event in events]

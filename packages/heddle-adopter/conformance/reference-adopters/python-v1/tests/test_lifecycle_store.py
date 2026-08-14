from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any

import pytest

from heddle_adopter_reference import ExecutionScope
from heddle_adopter_reference.lifecycle import (
    HostedConversationAcceptedTurn,
    HostedConversationExpiredTurnReconciliation,
    HostedConversationRequestedTurn,
    HostedConversationTurnIdentity,
    HostedConversationTurnLifecycleRecord,
    HostedConversationTurnSettlement,
)


@pytest.mark.asyncio
async def test_shared_store_fixture_certifies_lifecycle_and_scope_fencing(
    lifecycle_fixture: dict[str, Any],
) -> None:
    fixture = lifecycle_fixture["storeCases"]["lifecycleAndFencing"]
    store = InMemoryLifecycleStore()
    requested = _requested(fixture["requested"])
    accepted = _accepted(fixture["accepted"])
    completed = _settlement(fixture["completed"])

    await store.create_turn(requested)
    assert await store.find_turn(requested) == _record(
        {**fixture["requested"], "status": "requested"}
    )
    with pytest.raises(RuntimeError):
        await store.create_turn(requested)

    with pytest.raises(RuntimeError):
        await store.record_accepted(_accepted(fixture["wrongScopeAccepted"]))
    await store.record_accepted(accepted)
    await store.record_accepted(accepted)
    with pytest.raises(RuntimeError):
        await store.record_accepted(_accepted(fixture["conflictingAccepted"]))
    with pytest.raises(RuntimeError):
        await store.record_accepted(_accepted(fixture["conflictingAcceptedAt"]))
    assert await store.find_turn(requested) == _record(fixture["expectedRunning"])

    with pytest.raises(RuntimeError):
        await store.settle_turn(_settlement(fixture["wrongScopeCompleted"]))
    await store.settle_turn(completed)
    await store.settle_turn(completed)
    with pytest.raises(RuntimeError):
        await store.settle_turn(_settlement(fixture["conflictingCompleted"]))
    with pytest.raises(RuntimeError):
        await store.settle_turn(_settlement(fixture["conflictingSettledAt"]))
    with pytest.raises(RuntimeError):
        await store.record_accepted(accepted)
    assert await store.find_turn(requested) == _record(fixture["expectedCompleted"])


@pytest.mark.asyncio
async def test_shared_store_fixture_allows_pre_acceptance_failure(
    lifecycle_fixture: dict[str, Any],
) -> None:
    fixture = lifecycle_fixture["storeCases"]["preAcceptanceFailure"]
    store = InMemoryLifecycleStore()
    requested = _requested(fixture["requested"])
    settlement = _settlement(fixture["settlement"])

    await store.create_turn(requested)
    await store.settle_turn(settlement)

    record = await store.find_turn(requested)
    assert record is not None
    assert record.status == "failed"
    assert record.failure_code == "execution_failed"
    assert record.settled_at == settlement.settled_at


@pytest.mark.asyncio
async def test_shared_store_fixture_expires_only_open_rows_in_scope(
    lifecycle_fixture: dict[str, Any],
) -> None:
    fixture = lifecycle_fixture["storeCases"]["expiry"]
    store = InMemoryLifecycleStore()
    requested = {
        name: _requested(fixture[name])
        for name in [
            "expiredRequested",
            "expiredRunning",
            "futureRequested",
            "terminalRequested",
            "otherScopeExpired",
        ]
    }
    for turn in requested.values():
        await store.create_turn(turn)
    await store.record_accepted(_accepted(fixture["expiredRunningAcceptance"]))
    await store.settle_turn(_settlement(fixture["terminalSettlement"]))

    reconciliation = _reconciliation(fixture["reconciliation"])
    await store.interrupt_expired_turns(reconciliation)

    for name in ["expiredRequested", "expiredRunning"]:
        record = await store.find_turn(requested[name])
        assert record is not None
        assert record.status == "interrupted"
        assert record.failure_code == "deadline_elapsed"
        assert record.settled_at == reconciliation.settled_at
    assert await _status(store, requested["futureRequested"]) == "requested"
    assert await _status(store, requested["terminalRequested"]) == "failed"
    assert await _status(store, requested["otherScopeExpired"]) == "requested"


class InMemoryLifecycleStore:
    def __init__(self) -> None:
        self._turns: dict[str, HostedConversationTurnLifecycleRecord] = {}

    async def create_turn(self, turn: HostedConversationRequestedTurn) -> None:
        if turn.invocation_id in self._turns:
            raise RuntimeError("Invocation already exists.")
        self._turns[turn.invocation_id] = HostedConversationTurnLifecycleRecord(
            invocation_id=turn.invocation_id,
            scope=turn.scope,
            prompt=turn.prompt,
            requested_at=turn.requested_at,
            deadline_at=turn.deadline_at,
            status="requested",
        )

    async def record_accepted(self, turn: HostedConversationAcceptedTurn) -> None:
        record = self._require_scoped(turn)
        if (
            record.status == "running"
            and record.run_id == turn.run_id
            and record.accepted_at == turn.accepted_at
        ):
            return
        if record.status != "requested":
            raise RuntimeError("Invalid accepted transition.")
        self._turns[turn.invocation_id] = replace(
            record,
            status="running",
            run_id=turn.run_id,
            accepted_at=turn.accepted_at,
        )

    async def settle_turn(self, settlement: HostedConversationTurnSettlement) -> None:
        record = self._require_scoped(settlement)
        if record.status not in {"requested", "running"}:
            if (
                record.status == settlement.status
                and record.summary == settlement.summary
                and record.failure_code == settlement.failure_code
                and record.settled_at == settlement.settled_at
            ):
                return
            raise RuntimeError("Invalid terminal transition.")
        if record.status == "requested" and settlement.status not in {
            "failed",
            "interrupted",
        }:
            raise RuntimeError("Invalid pre-acceptance terminal transition.")
        self._turns[settlement.invocation_id] = replace(
            record,
            status=settlement.status,
            summary=settlement.summary,
            failure_code=settlement.failure_code,
            settled_at=settlement.settled_at,
        )

    async def interrupt_expired_turns(
        self,
        reconciliation: HostedConversationExpiredTurnReconciliation,
    ) -> None:
        expired_before = _parse_timestamp(reconciliation.expired_before)
        for invocation_id, record in list(self._turns.items()):
            if (
                record.scope == reconciliation.scope
                and record.status in {"requested", "running"}
                and record.deadline_at is not None
                and _parse_timestamp(record.deadline_at) < expired_before
            ):
                self._turns[invocation_id] = replace(
                    record,
                    status="interrupted",
                    failure_code="deadline_elapsed",
                    settled_at=reconciliation.settled_at,
                )

    async def find_turn(
        self,
        identity: HostedConversationTurnIdentity,
    ) -> HostedConversationTurnLifecycleRecord | None:
        record = self._turns.get(identity.invocation_id)
        return record if record is not None and record.scope == identity.scope else None

    def _require_scoped(
        self,
        identity: HostedConversationTurnIdentity,
    ) -> HostedConversationTurnLifecycleRecord:
        record = self._turns.get(identity.invocation_id)
        if record is None or record.scope != identity.scope:
            raise RuntimeError("Invocation not found in scope.")
        return record


def _scope(raw: dict[str, str]) -> ExecutionScope:
    return ExecutionScope(
        tenant_id=raw["tenantId"],
        subject_id=raw["subjectId"],
        product_session_id=raw["productSessionId"],
    )


def _requested(raw: dict[str, Any]) -> HostedConversationRequestedTurn:
    return HostedConversationRequestedTurn(
        invocation_id=raw["invocationId"],
        scope=_scope(raw["scope"]),
        prompt=raw["prompt"],
        requested_at=raw["requestedAt"],
        deadline_at=raw.get("deadlineAt"),
    )


def _accepted(raw: dict[str, Any]) -> HostedConversationAcceptedTurn:
    return HostedConversationAcceptedTurn(
        invocation_id=raw["invocationId"],
        scope=_scope(raw["scope"]),
        run_id=raw["runId"],
        accepted_at=raw["acceptedAt"],
    )


def _settlement(raw: dict[str, Any]) -> HostedConversationTurnSettlement:
    return HostedConversationTurnSettlement(
        invocation_id=raw["invocationId"],
        scope=_scope(raw["scope"]),
        status=raw["status"],
        summary=raw.get("summary"),
        failure_code=raw.get("failureCode"),
        settled_at=raw["settledAt"],
    )


def _reconciliation(raw: dict[str, Any]) -> HostedConversationExpiredTurnReconciliation:
    return HostedConversationExpiredTurnReconciliation(
        scope=_scope(raw["scope"]),
        expired_before=raw["expiredBefore"],
        settled_at=raw["settledAt"],
    )


def _record(raw: dict[str, Any]) -> HostedConversationTurnLifecycleRecord:
    return HostedConversationTurnLifecycleRecord(
        invocation_id=raw["invocationId"],
        scope=_scope(raw["scope"]),
        prompt=raw["prompt"],
        requested_at=raw["requestedAt"],
        status=raw["status"],
        deadline_at=raw.get("deadlineAt"),
        run_id=raw.get("runId"),
        summary=raw.get("summary"),
        failure_code=raw.get("failureCode"),
        accepted_at=raw.get("acceptedAt"),
        settled_at=raw.get("settledAt"),
    )


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def _status(
    store: InMemoryLifecycleStore,
    identity: HostedConversationTurnIdentity,
) -> str:
    record = await store.find_turn(identity)
    assert record is not None
    return record.status

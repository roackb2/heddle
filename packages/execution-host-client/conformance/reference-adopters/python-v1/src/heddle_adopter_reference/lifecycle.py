"""Clean-room durable hosted-conversation lifecycle profile v1."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from .contracts import (
    ExecutionScope,
    validate_opaque_id,
    validate_runtime_session_id,
    validate_timestamp,
)
from .errors import (
    ExecutionHostInvocationCancelledError,
    ExecutionHostProtocolError,
    ExecutionHostRejectedError,
    ExecutionHostStreamInterruptedError,
)

HostedConversationTurnStatus = Literal[
    "requested",
    "running",
    "completed",
    "max_steps",
    "failed",
    "cancelled",
    "interrupted",
]
HostedConversationTerminalStatus = Literal[
    "completed",
    "max_steps",
    "failed",
    "cancelled",
    "interrupted",
]
HostedConversationFailureCode = Literal[
    "deadline_elapsed",
    "execution_error",
    "execution_failed",
    "execution_interrupted",
    "execution_result_error",
    "host_protocol_error",
    "host_rejected",
    "invocation_aborted",
    "invocation_cancelled",
    "model_authentication",
    "model_context_window",
    "model_empty_response",
    "model_permission",
    "model_quota",
    "model_rate_limit",
    "model_request",
    "model_transport",
    "model_unknown",
    "stream_ended_without_terminal",
    "stream_interrupted",
]

HOSTED_CONVERSATION_TURN_STATUSES = frozenset(
    {
        "requested",
        "running",
        "completed",
        "max_steps",
        "failed",
        "cancelled",
        "interrupted",
    }
)
HOSTED_CONVERSATION_FAILED_CODES = frozenset(
    {
        "execution_error",
        "execution_failed",
        "execution_result_error",
        "host_protocol_error",
        "host_rejected",
        "model_authentication",
        "model_context_window",
        "model_empty_response",
        "model_permission",
        "model_quota",
        "model_rate_limit",
        "model_request",
        "model_transport",
        "model_unknown",
    }
)
HOSTED_CONVERSATION_INTERRUPTED_CODES = frozenset(
    {
        "deadline_elapsed",
        "execution_interrupted",
        "invocation_aborted",
        "stream_ended_without_terminal",
        "stream_interrupted",
    }
)
HOSTED_CONVERSATION_CANCELLED_CODES = frozenset({"invocation_cancelled"})
HOSTED_CONVERSATION_FAILURE_CODES = frozenset(
    HOSTED_CONVERSATION_FAILED_CODES
    | HOSTED_CONVERSATION_INTERRUPTED_CODES
    | HOSTED_CONVERSATION_CANCELLED_CODES
)

_MODEL_FAILURE_CODES: Mapping[str, HostedConversationFailureCode] = {
    "authentication": "model_authentication",
    "permission": "model_permission",
    "quota": "model_quota",
    "rate_limit": "model_rate_limit",
    "context_window": "model_context_window",
    "request": "model_request",
    "transport": "model_transport",
    "empty_response": "model_empty_response",
    "unknown": "model_unknown",
}
_TERMINAL_KINDS = frozenset({"result", "cancelled", "error"})
_DEFAULT_MAX_SUMMARY_CHARACTERS = 100_000
_DEFAULT_EXPIRED_TURN_GRACE_MS = 60_000


@dataclass(frozen=True)
class HostedConversationTurnInput:
    scope: ExecutionScope
    runtime_session_id: str
    invocation_id: str
    prompt: str
    deadline_at: str | None = None

    def __post_init__(self) -> None:
        validate_runtime_session_id(self.runtime_session_id)
        validate_opaque_id(self.invocation_id)
        prompt = self.prompt.strip()
        if not 1 <= len(prompt) <= 200_000:
            raise ValueError("Expected a non-empty bounded prompt.")
        object.__setattr__(self, "prompt", prompt)
        if self.deadline_at is not None:
            validate_timestamp(self.deadline_at)


@dataclass(frozen=True)
class HostedConversationTurnIdentity:
    invocation_id: str
    scope: ExecutionScope

    def __post_init__(self) -> None:
        validate_opaque_id(self.invocation_id)


@dataclass(frozen=True)
class HostedConversationRequestedTurn(HostedConversationTurnIdentity):
    prompt: str
    requested_at: str
    deadline_at: str | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        prompt = self.prompt.strip()
        if not 1 <= len(prompt) <= 200_000:
            raise ValueError("Expected a non-empty bounded prompt.")
        object.__setattr__(self, "prompt", prompt)
        validate_timestamp(self.requested_at)
        if self.deadline_at is not None:
            validate_timestamp(self.deadline_at)


@dataclass(frozen=True)
class HostedConversationAcceptedTurn(HostedConversationTurnIdentity):
    run_id: str
    accepted_at: str

    def __post_init__(self) -> None:
        super().__post_init__()
        validate_opaque_id(self.run_id)
        validate_timestamp(self.accepted_at)


@dataclass(frozen=True)
class HostedConversationTerminalOutcome:
    status: HostedConversationTerminalStatus
    summary: str | None = None
    failure_code: HostedConversationFailureCode | None = None

    def __post_init__(self) -> None:
        _validate_terminal(self.status, self.summary, self.failure_code)


@dataclass(frozen=True)
class HostedConversationTurnSettlement(HostedConversationTurnIdentity):
    status: HostedConversationTerminalStatus
    settled_at: str
    summary: str | None = None
    failure_code: HostedConversationFailureCode | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        validate_timestamp(self.settled_at)
        _validate_terminal(self.status, self.summary, self.failure_code)


@dataclass(frozen=True)
class HostedConversationTurnLifecycleRecord(HostedConversationTurnIdentity):
    prompt: str
    requested_at: str
    status: HostedConversationTurnStatus
    deadline_at: str | None = None
    run_id: str | None = None
    summary: str | None = None
    failure_code: HostedConversationFailureCode | None = None
    accepted_at: str | None = None
    settled_at: str | None = None


@dataclass(frozen=True)
class HostedConversationExpiredTurnReconciliation:
    scope: ExecutionScope
    expired_before: str
    settled_at: str

    def __post_init__(self) -> None:
        validate_timestamp(self.expired_before)
        validate_timestamp(self.settled_at)


@dataclass(frozen=True)
class HostedConversationTerminalProjection:
    event: Mapping[str, Any]
    settlement: HostedConversationTerminalOutcome


class HostedConversationTurnRunner(Protocol):
    def stream_turn(
        self,
        turn: HostedConversationTurnInput,
    ) -> AsyncIterator[Mapping[str, Any]]: ...


class HostedConversationTurnLifecycleStore(Protocol):
    async def create_turn(self, turn: HostedConversationRequestedTurn) -> None: ...

    async def record_accepted(self, turn: HostedConversationAcceptedTurn) -> None: ...

    async def settle_turn(self, settlement: HostedConversationTurnSettlement) -> None: ...

    async def interrupt_expired_turns(
        self,
        reconciliation: HostedConversationExpiredTurnReconciliation,
    ) -> None: ...


class DurableHostedConversationTurnService:
    """Applies the normative durable profile around one hosted-turn runner."""

    def __init__(
        self,
        turns: HostedConversationTurnRunner,
        store: HostedConversationTurnLifecycleStore,
        *,
        max_summary_characters: int = _DEFAULT_MAX_SUMMARY_CHARACTERS,
        expired_turn_grace_ms: int = _DEFAULT_EXPIRED_TURN_GRACE_MS,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        _validate_max_summary_characters(max_summary_characters)
        _validate_expired_turn_grace_ms(expired_turn_grace_ms)
        self._turns = turns
        self._store = store
        self._max_summary_characters = max_summary_characters
        self._expired_turn_grace_ms = expired_turn_grace_ms
        self._now = now or (lambda: datetime.now(UTC))

    async def stream_turn(
        self,
        turn: HostedConversationTurnInput,
    ) -> AsyncIterator[Mapping[str, Any]]:
        identity = HostedConversationTurnIdentity(
            invocation_id=turn.invocation_id,
            scope=turn.scope,
        )
        await self._store.create_turn(
            HostedConversationRequestedTurn(
                invocation_id=identity.invocation_id,
                scope=identity.scope,
                prompt=turn.prompt,
                requested_at=_iso_timestamp(self._now()),
                deadline_at=turn.deadline_at,
            )
        )

        persistence_state = "open"
        stream_accepted = False

        async def settle(
            outcome: HostedConversationTerminalOutcome,
            settled_at: str,
        ) -> None:
            nonlocal persistence_state
            persistence_state = "settling"
            await self._store.settle_turn(
                HostedConversationTurnSettlement(
                    invocation_id=identity.invocation_id,
                    scope=identity.scope,
                    status=outcome.status,
                    summary=outcome.summary,
                    failure_code=outcome.failure_code,
                    settled_at=settled_at,
                )
            )
            persistence_state = "settled"

        try:
            async for event in self._turns.stream_turn(turn):
                kind = _event_kind(event)
                if kind == "accepted":
                    if stream_accepted:
                        raise ExecutionHostProtocolError(
                            "Hosted turn emitted more than one accepted event."
                        )
                    try:
                        await self._store.record_accepted(
                            HostedConversationAcceptedTurn(
                                invocation_id=identity.invocation_id,
                                scope=identity.scope,
                                run_id=_event_string(event, "runId"),
                                accepted_at=_event_string(event, "timestamp"),
                            )
                        )
                    except BaseException:
                        persistence_state = "write_failed"
                        raise
                    stream_accepted = True
                    yield event
                    continue
                if not stream_accepted:
                    raise ExecutionHostProtocolError(
                        "Hosted turn emitted data before its accepted event."
                    )
                if kind in _TERMINAL_KINDS:
                    projection = project_hosted_conversation_terminal_event(
                        event,
                        max_summary_characters=self._max_summary_characters,
                    )
                    await settle(
                        projection.settlement,
                        _event_string(event, "timestamp"),
                    )
                    yield projection.event
                    return
                if kind != "activity":
                    raise ExecutionHostProtocolError()
                yield event

            if not stream_accepted:
                raise ExecutionHostProtocolError("Hosted turn stream omitted its accepted event.")
            if persistence_state == "open":
                await settle(
                    HostedConversationTerminalOutcome(
                        status="interrupted",
                        failure_code="stream_ended_without_terminal",
                    ),
                    _iso_timestamp(self._now()),
                )
        except asyncio.CancelledError:
            if persistence_state == "open":
                await settle(
                    HostedConversationTerminalOutcome(
                        status="interrupted",
                        failure_code="invocation_aborted",
                    ),
                    _iso_timestamp(self._now()),
                )
            raise
        except Exception as error:
            if persistence_state == "open":
                await settle(_project_thrown_failure(error), _iso_timestamp(self._now()))
            raise
        finally:
            if persistence_state == "open":
                await settle(
                    HostedConversationTerminalOutcome(
                        status="interrupted",
                        failure_code="stream_ended_without_terminal",
                    ),
                    _iso_timestamp(self._now()),
                )

    async def interrupt_expired_turns(self, scope: ExecutionScope) -> None:
        await interrupt_expired_hosted_conversation_turns(
            self._store,
            scope,
            expired_turn_grace_ms=self._expired_turn_grace_ms,
            now=self._now,
        )


async def interrupt_expired_hosted_conversation_turns(
    store: HostedConversationTurnLifecycleStore,
    scope: ExecutionScope,
    *,
    expired_turn_grace_ms: int = _DEFAULT_EXPIRED_TURN_GRACE_MS,
    now: Callable[[], datetime] | None = None,
) -> None:
    _validate_expired_turn_grace_ms(expired_turn_grace_ms)
    current = (now or (lambda: datetime.now(UTC)))()
    _validate_clock(current)
    await store.interrupt_expired_turns(
        HostedConversationExpiredTurnReconciliation(
            scope=scope,
            expired_before=_iso_timestamp(current - timedelta(milliseconds=expired_turn_grace_ms)),
            settled_at=_iso_timestamp(current),
        )
    )


def project_hosted_conversation_terminal_event(
    event: Mapping[str, Any],
    *,
    max_summary_characters: int = _DEFAULT_MAX_SUMMARY_CHARACTERS,
) -> HostedConversationTerminalProjection:
    _validate_max_summary_characters(max_summary_characters)
    kind = _event_kind(event)
    if kind == "cancelled":
        return HostedConversationTerminalProjection(
            event=event,
            settlement=HostedConversationTerminalOutcome(
                status="cancelled",
                failure_code="invocation_cancelled",
            ),
        )
    if kind == "error":
        return HostedConversationTerminalProjection(
            event=event,
            settlement=HostedConversationTerminalOutcome(
                status="failed",
                failure_code="execution_error",
            ),
        )
    if kind != "result":
        raise ExecutionHostProtocolError("Expected a terminal event.")

    raw_result = event.get("result")
    if not isinstance(raw_result, Mapping):
        raise ExecutionHostProtocolError()
    outcome = raw_result.get("outcome")
    raw_summary = raw_result.get("summary")
    if raw_summary is not None and not isinstance(raw_summary, str):
        raise ExecutionHostProtocolError()
    summary = raw_summary[:max_summary_characters] if raw_summary is not None else None
    projected_event = event
    if summary != raw_summary:
        projected_event = {**event, "result": {**raw_result, "summary": summary}}

    if outcome == "done":
        settlement = HostedConversationTerminalOutcome(status="completed", summary=summary)
    elif outcome == "max_steps":
        settlement = HostedConversationTerminalOutcome(status="max_steps", summary=summary)
    elif outcome == "interrupted":
        settlement = HostedConversationTerminalOutcome(
            status="interrupted",
            summary=summary,
            failure_code="execution_interrupted",
        )
    elif outcome == "error":
        settlement = HostedConversationTerminalOutcome(
            status="failed",
            summary=summary,
            failure_code=_result_failure_code(raw_result),
        )
    else:
        raise ExecutionHostProtocolError()
    return HostedConversationTerminalProjection(
        event=projected_event,
        settlement=settlement,
    )


def _result_failure_code(result: Mapping[str, Any]) -> HostedConversationFailureCode:
    failure = result.get("failure")
    if failure is None:
        return "execution_result_error"
    if not isinstance(failure, Mapping):
        raise ExecutionHostProtocolError()
    code = failure.get("code")
    if failure.get("source") != "model" or code not in _MODEL_FAILURE_CODES:
        raise ExecutionHostProtocolError()
    assert isinstance(code, str)
    return _MODEL_FAILURE_CODES[code]


def _project_thrown_failure(error: Exception) -> HostedConversationTerminalOutcome:
    if isinstance(error, ExecutionHostStreamInterruptedError):
        return HostedConversationTerminalOutcome(
            status="interrupted",
            failure_code="stream_interrupted",
        )
    if isinstance(error, ExecutionHostInvocationCancelledError):
        return HostedConversationTerminalOutcome(
            status="interrupted",
            failure_code="invocation_aborted",
        )
    if isinstance(error, ExecutionHostProtocolError):
        return HostedConversationTerminalOutcome(
            status="failed",
            failure_code="host_protocol_error",
        )
    if isinstance(error, ExecutionHostRejectedError):
        return HostedConversationTerminalOutcome(status="failed", failure_code="host_rejected")
    return HostedConversationTerminalOutcome(status="failed", failure_code="execution_failed")


def _validate_terminal(
    status: HostedConversationTerminalStatus,
    summary: str | None,
    failure_code: HostedConversationFailureCode | None,
) -> None:
    if summary is not None and len(summary) > 1_000_000:
        raise ValueError("Expected a bounded summary.")
    valid = (
        (status in {"completed", "max_steps"} and failure_code is None)
        or (status == "failed" and failure_code in HOSTED_CONVERSATION_FAILED_CODES)
        or (status == "interrupted" and failure_code in HOSTED_CONVERSATION_INTERRUPTED_CODES)
        or (
            status == "cancelled"
            and failure_code in HOSTED_CONVERSATION_CANCELLED_CODES
            and summary is None
        )
    )
    if not valid:
        raise ValueError("Expected a valid terminal status and failure-code combination.")


def _event_kind(event: Mapping[str, Any]) -> str:
    kind = event.get("kind")
    if not isinstance(kind, str):
        raise ExecutionHostProtocolError()
    return kind


def _event_string(event: Mapping[str, Any], name: str) -> str:
    value = event.get(name)
    if not isinstance(value, str):
        raise ExecutionHostProtocolError()
    if name == "timestamp":
        try:
            validate_timestamp(value)
        except ValueError as error:
            raise ExecutionHostProtocolError() from error
    return value


def _validate_max_summary_characters(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 1_000_000:
        raise ValueError("Expected a summary limit between 1 and 1,000,000 characters.")


def _validate_expired_turn_grace_ms(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 86_400_000:
        raise ValueError("Expected an expiry grace between zero and one day.")


def _iso_timestamp(value: datetime) -> str:
    _validate_clock(value)
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _validate_clock(value: datetime) -> None:
    if value.tzinfo is None:
        raise ValueError("Lifecycle clock must return a timezone-aware datetime.")

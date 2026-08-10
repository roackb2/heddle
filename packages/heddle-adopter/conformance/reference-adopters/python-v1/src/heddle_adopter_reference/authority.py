"""ES256 execution authority for the language-neutral adopter contract."""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from .contracts import (
    CONVERSATION_TURN_WORKFLOW,
    EXECUTION_ASSERTION_TYPE,
    EXECUTION_CONTRACT_VERSION,
    MCP_CAPABILITY_TYPE,
    validate_allowed_tools,
    validate_mcp_server_id,
    validate_opaque_id,
    validate_runtime_session_id,
    validate_safe_web_url,
)

_MAX_AUDIENCE_LENGTH = 512
_MAX_TTL_SECONDS = 15 * 60


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


@dataclass(frozen=True)
class ExecutionAuthorityMcpConfig:
    audience: str
    server_id: str
    ttl_seconds: int

    def __post_init__(self) -> None:
        _validate_audience(self.audience)
        validate_mcp_server_id(self.server_id)
        _validate_ttl(self.ttl_seconds)


@dataclass(frozen=True)
class ExecutionAuthorityConfig:
    issuer: str
    adopter_id: str
    execution_audience: str
    key_id: str
    execution_ttl_seconds: int
    mcp: ExecutionAuthorityMcpConfig | None = None

    def __post_init__(self) -> None:
        validate_safe_web_url(self.issuer)
        validate_opaque_id(self.adopter_id)
        _validate_audience(self.execution_audience)
        validate_opaque_id(self.key_id)
        _validate_ttl(self.execution_ttl_seconds)
        if self.mcp is None:
            return
        if self.execution_audience == self.mcp.audience:
            raise ValueError("Execution and MCP audiences must be distinct.")
        if self.mcp.ttl_seconds < self.execution_ttl_seconds:
            raise ValueError("MCP authority must not expire before execution authority.")


@dataclass(frozen=True)
class ExecutionAuthorityInput:
    scope: ExecutionScope
    runtime_session_id: str
    invocation_id: str
    workflow: str = CONVERSATION_TURN_WORKFLOW
    allowed_tools: Sequence[str] | None = None

    def __post_init__(self) -> None:
        validate_runtime_session_id(self.runtime_session_id)
        validate_opaque_id(self.invocation_id)
        if self.workflow != CONVERSATION_TURN_WORKFLOW:
            raise ValueError("Unsupported execution workflow.")
        if self.allowed_tools is not None:
            object.__setattr__(self, "allowed_tools", validate_allowed_tools(self.allowed_tools))


class IssuedExecutionAuthority:
    """Credentials with an explicitly credential-free JSON representation."""

    __slots__ = ("__execution_assertion", "__mcp_capability", "_metadata")

    def __init__(
        self,
        execution_assertion: str,
        mcp_capability: str | None,
        metadata: Mapping[str, Any],
    ) -> None:
        self.__execution_assertion = execution_assertion
        self.__mcp_capability = mcp_capability
        self._metadata = _freeze_mapping(metadata)

    @property
    def metadata(self) -> Mapping[str, Any]:
        return self._metadata

    def execution_assertion(self) -> str:
        return self.__execution_assertion

    def mcp_capability(self) -> str | None:
        return self.__mcp_capability

    def to_json(self) -> Mapping[str, Any]:
        return _thaw(self.metadata)

    def __repr__(self) -> str:
        return f"IssuedExecutionAuthority(metadata={dict(self.metadata)!r})"


class JoseExecutionAuthority:
    """Issues short-lived v1 assertions without importing Heddle."""

    def __init__(
        self,
        config: ExecutionAuthorityConfig,
        private_key: ec.EllipticCurvePrivateKey,
        *,
        now: Callable[[], datetime] | None = None,
        create_capability_id: Callable[[], str] | None = None,
    ) -> None:
        if not isinstance(private_key.curve, ec.SECP256R1):
            raise ValueError("Execution authority requires an ES256 P-256 signing key.")
        self._config = config
        self.__private_key = private_key
        self._now = now or (lambda: datetime.now(UTC))
        self._create_capability_id = create_capability_id or (lambda: str(uuid.uuid4()))

    def issue(self, authority: ExecutionAuthorityInput) -> IssuedExecutionAuthority:
        if authority.allowed_tools is not None and self._config.mcp is None:
            raise ValueError("MCP tools require MCP deployment configuration.")

        issued_at = _epoch_seconds(self._now())
        execution_expires_at = issued_at + self._config.execution_ttl_seconds
        execution_claims = {
            "contractVersion": EXECUTION_CONTRACT_VERSION,
            "adopterId": self._config.adopter_id,
            "tenantId": authority.scope.tenant_id,
            "productSessionId": authority.scope.product_session_id,
            "runtimeSessionId": authority.runtime_session_id,
            "workflow": authority.workflow,
            "iss": self._config.issuer,
            "aud": self._config.execution_audience,
            "sub": authority.scope.subject_id,
            "jti": authority.invocation_id,
            "iat": issued_at,
            "exp": execution_expires_at,
        }
        execution_assertion = self._encode(execution_claims, EXECUTION_ASSERTION_TYPE)

        mcp_assertion: str | None = None
        mcp_metadata: dict[str, Any] | None = None
        if authority.allowed_tools is not None:
            mcp_assertion, mcp_metadata = self._issue_mcp(authority, issued_at)

        metadata: dict[str, Any] = {
            "scope": {
                "adopterId": self._config.adopter_id,
                "tenantId": authority.scope.tenant_id,
                "subjectId": authority.scope.subject_id,
                "productSessionId": authority.scope.product_session_id,
            },
            "runtimeSessionId": authority.runtime_session_id,
            "invocationId": authority.invocation_id,
            "workflow": authority.workflow,
            "issuedAt": _iso_timestamp(issued_at),
            "executionExpiresAt": _iso_timestamp(execution_expires_at),
        }
        if mcp_metadata is not None:
            metadata["mcp"] = mcp_metadata
        return IssuedExecutionAuthority(execution_assertion, mcp_assertion, metadata)

    def public_jwks(self) -> Mapping[str, Any]:
        numbers = self.__private_key.public_key().public_numbers()
        key = {
            "kty": "EC",
            "crv": "P-256",
            "x": _base64url_uint(numbers.x, 32),
            "y": _base64url_uint(numbers.y, 32),
            "alg": "ES256",
            "kid": self._config.key_id,
            "use": "sig",
        }
        return _freeze_mapping({"keys": [key]})

    def _issue_mcp(
        self,
        authority: ExecutionAuthorityInput,
        issued_at: int,
    ) -> tuple[str, dict[str, Any]]:
        mcp = self._config.mcp
        assert mcp is not None
        assert authority.allowed_tools is not None
        capability_id = validate_opaque_id(self._create_capability_id())
        if capability_id == authority.invocation_id:
            raise ValueError("MCP capability identity must differ from invocation identity.")
        expires_at = issued_at + mcp.ttl_seconds
        claims = {
            "contractVersion": EXECUTION_CONTRACT_VERSION,
            "adopterId": self._config.adopter_id,
            "tenantId": authority.scope.tenant_id,
            "productSessionId": authority.scope.product_session_id,
            "runtimeSessionId": authority.runtime_session_id,
            "invocationId": authority.invocation_id,
            "workflow": authority.workflow,
            "serverId": mcp.server_id,
            "allowedTools": list(authority.allowed_tools),
            "iss": self._config.issuer,
            "aud": mcp.audience,
            "sub": authority.scope.subject_id,
            "jti": capability_id,
            "iat": issued_at,
            "exp": expires_at,
        }
        return self._encode(claims, MCP_CAPABILITY_TYPE), {
            "capabilityId": capability_id,
            "serverId": mcp.server_id,
            "allowedTools": list(authority.allowed_tools),
            "expiresAt": _iso_timestamp(expires_at),
        }

    def _encode(self, claims: Mapping[str, Any], token_type: str) -> str:
        return jwt.encode(
            dict(claims),
            self.__private_key,
            algorithm="ES256",
            headers={"alg": "ES256", "kid": self._config.key_id, "typ": token_type},
        )


def generate_ephemeral_signing_key() -> ec.EllipticCurvePrivateKey:
    """Generates a non-exported process-local key for tests and local demos."""

    return ec.generate_private_key(ec.SECP256R1())


def _validate_audience(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= _MAX_AUDIENCE_LENGTH:
        raise ValueError("Expected a bounded audience identifier.")
    return value


def _validate_ttl(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= _MAX_TTL_SECONDS:
        raise ValueError("Expected a TTL between 1 and 900 seconds.")
    return value


def _epoch_seconds(value: datetime) -> int:
    if value.tzinfo is None:
        raise ValueError("Execution authority clock must return a timezone-aware datetime.")
    seconds = int(value.timestamp())
    if seconds < 0:
        raise ValueError("Execution authority clock returned an invalid time.")
    return seconds


def _iso_timestamp(epoch_seconds: int) -> str:
    return (
        datetime.fromtimestamp(epoch_seconds, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _base64url_uint(value: int, length: int) -> str:
    return base64.urlsafe_b64encode(value.to_bytes(length, "big")).rstrip(b"=").decode("ascii")


def _freeze_mapping(value: Mapping[str, Any]) -> Mapping[str, Any]:
    def freeze(item: Any) -> Any:
        if isinstance(item, Mapping):
            return MappingProxyType({key: freeze(child) for key, child in item.items()})
        if isinstance(item, list | tuple):
            return tuple(freeze(child) for child in item)
        return item

    frozen = freeze(value)
    assert isinstance(frozen, Mapping)
    return frozen


def metadata_json(authority: IssuedExecutionAuthority) -> str:
    """Serializes only credential-free authority metadata."""

    return json.dumps(authority.to_json(), sort_keys=True)


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(child) for key, child in value.items()}
    if isinstance(value, tuple):
        return [_thaw(child) for child in value]
    return value

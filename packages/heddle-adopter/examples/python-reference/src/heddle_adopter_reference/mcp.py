"""Independent product-MCP capability verification for Python adopters."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Protocol

import jwt
from mcp.server.auth.provider import AccessToken

from .contracts import (
    CONVERSATION_TURN_WORKFLOW,
    EXECUTION_CONTRACT_VERSION,
    MCP_CAPABILITY_TYPE,
    validate_allowed_tools,
    validate_mcp_server_id,
    validate_opaque_id,
    validate_runtime_session_id,
    validate_safe_web_url,
)
from .errors import McpCapabilityVerificationError


class JwksProvider(Protocol):
    def resolve(self, key_id: str) -> Any:
        """Returns a verification key for one protected JWT key ID."""


class StaticJwksProvider:
    """Small local-JWKS provider used by the reference and deterministic tests."""

    def __init__(self, jwks: Mapping[str, Any]) -> None:
        keys = jwks.get("keys")
        if not isinstance(keys, Sequence) or isinstance(keys, str | bytes):
            raise ValueError("JWKS must contain a keys array.")
        resolved: dict[str, Any] = {}
        for raw_key in keys:
            if not isinstance(raw_key, Mapping):
                raise ValueError("JWKS contains an invalid key.")
            key = dict(raw_key)
            key_id = key.get("kid")
            if (
                not isinstance(key_id, str)
                or key_id in resolved
                or key.get("kty") != "EC"
                or key.get("crv") != "P-256"
                or key.get("alg") not in {None, "ES256"}
                or key.get("use") not in {None, "sig"}
                or "d" in key
            ):
                raise ValueError("JWKS contains an unsupported or ambiguous key.")
            resolved[key_id] = jwt.PyJWK.from_dict(key, algorithm="ES256").key
        if not resolved:
            raise ValueError("JWKS must contain at least one public ES256 key.")
        self._keys = MappingProxyType(resolved)

    def resolve(self, key_id: str) -> Any:
        try:
            return self._keys[key_id]
        except KeyError as error:
            raise McpCapabilityVerificationError() from error


@dataclass(frozen=True)
class McpCapabilityVerifierConfig:
    issuer: str
    audience: str
    trusted_adopter_id: str
    server_id: str
    supported_tools: Sequence[str]
    max_capability_age_seconds: int
    clock_tolerance_seconds: int = 5

    def __post_init__(self) -> None:
        validate_safe_web_url(self.issuer)
        if not 1 <= len(self.audience) <= 512:
            raise ValueError("Expected a bounded MCP audience.")
        validate_opaque_id(self.trusted_adopter_id)
        validate_mcp_server_id(self.server_id)
        tools = validate_allowed_tools(self.supported_tools)
        object.__setattr__(self, "supported_tools", tools)
        if (
            isinstance(self.max_capability_age_seconds, bool)
            or not isinstance(self.max_capability_age_seconds, int)
            or not 1 <= self.max_capability_age_seconds <= 15 * 60
        ):
            raise ValueError("Expected a bounded MCP capability age.")
        if (
            isinstance(self.clock_tolerance_seconds, bool)
            or not isinstance(self.clock_tolerance_seconds, int)
            or not 0 <= self.clock_tolerance_seconds <= 60
        ):
            raise ValueError("Expected a clock tolerance between 0 and 60 seconds.")


@dataclass(frozen=True)
class McpInvocationScope:
    adopter_id: str
    tenant_id: str
    subject_id: str
    product_session_id: str
    runtime_session_id: str
    invocation_id: str
    workflow: str


@dataclass(frozen=True)
class VerifiedMcpCapability:
    capability_id: str
    server_id: str
    allowed_tools: tuple[str, ...]
    scope: McpInvocationScope
    issued_at: str
    expires_at: str


class JwtMcpCapabilityVerifier:
    """Verifies the capability again at the adopter's own MCP boundary."""

    def __init__(
        self,
        config: McpCapabilityVerifierConfig,
        jwks_provider: JwksProvider,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._config = config
        self._jwks_provider = jwks_provider
        self._supported_tools = frozenset(config.supported_tools)
        self._now = now or (lambda: datetime.now(UTC))

    def verify(self, assertion: str) -> VerifiedMcpCapability:
        try:
            if not isinstance(assertion, str) or not 32 <= len(assertion) <= 4_096:
                raise ValueError("Invalid assertion length.")
            protected = jwt.get_unverified_header(assertion)
            if (
                protected.get("alg") != "ES256"
                or protected.get("typ") != MCP_CAPABILITY_TYPE
                or not isinstance(protected.get("kid"), str)
            ):
                raise ValueError("Invalid protected header.")
            key = self._jwks_provider.resolve(protected["kid"])
            claims = jwt.decode(
                assertion,
                key,
                algorithms=["ES256"],
                issuer=self._config.issuer,
                audience=self._config.audience,
                options={
                    "require": ["exp", "iat", "jti", "sub"],
                    "verify_exp": False,
                    "verify_iat": False,
                    "verify_nbf": False,
                },
            )
            return self._verify_claims(claims)
        except McpCapabilityVerificationError:
            raise
        except Exception as error:
            raise McpCapabilityVerificationError() from error

    def _verify_claims(self, claims: Mapping[str, Any]) -> VerifiedMcpCapability:
        contract_version = _integer_claim(claims, "contractVersion")
        issued_at = _integer_claim(claims, "iat")
        expires_at = _integer_claim(claims, "exp")
        adopter_id = _string_claim(claims, "adopterId", validate_opaque_id)
        tenant_id = _string_claim(claims, "tenantId", validate_opaque_id)
        subject_id = _string_claim(claims, "sub", validate_opaque_id)
        product_session_id = _string_claim(claims, "productSessionId", validate_opaque_id)
        runtime_session_id = _string_claim(claims, "runtimeSessionId", validate_runtime_session_id)
        invocation_id = _string_claim(claims, "invocationId", validate_opaque_id)
        capability_id = _string_claim(claims, "jti", validate_opaque_id)
        server_id = _string_claim(claims, "serverId", validate_mcp_server_id)
        workflow = _string_claim(claims, "workflow")
        allowed_tools_value = claims.get("allowedTools")
        if not isinstance(allowed_tools_value, Sequence) or isinstance(
            allowed_tools_value, str | bytes
        ):
            raise ValueError("Invalid tool allowlist.")
        allowed_tools = validate_allowed_tools(allowed_tools_value)

        now = _epoch_seconds(self._now())
        tolerance = self._config.clock_tolerance_seconds
        lifetime = expires_at - issued_at
        valid_time = (
            lifetime > 0
            and lifetime <= self._config.max_capability_age_seconds
            and issued_at <= now + tolerance
            and now - issued_at <= self._config.max_capability_age_seconds + tolerance
            and now < expires_at + tolerance
        )
        valid_binding = (
            contract_version == EXECUTION_CONTRACT_VERSION
            and adopter_id == self._config.trusted_adopter_id
            and server_id == self._config.server_id
            and workflow == CONVERSATION_TURN_WORKFLOW
            and capability_id != invocation_id
            and all(tool in self._supported_tools for tool in allowed_tools)
        )
        if not valid_time or not valid_binding:
            raise McpCapabilityVerificationError()

        return VerifiedMcpCapability(
            capability_id=capability_id,
            server_id=server_id,
            allowed_tools=allowed_tools,
            scope=McpInvocationScope(
                adopter_id=adopter_id,
                tenant_id=tenant_id,
                subject_id=subject_id,
                product_session_id=product_session_id,
                runtime_session_id=runtime_session_id,
                invocation_id=invocation_id,
                workflow=workflow,
            ),
            issued_at=_iso_timestamp(issued_at),
            expires_at=_iso_timestamp(expires_at),
        )


class McpSdkCapabilityTokenVerifier:
    """Official MCP SDK TokenVerifier adapter with no bearer retention."""

    def __init__(
        self,
        verifier: JwtMcpCapabilityVerifier,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._verifier = verifier
        self._now = now or (lambda: datetime.now(UTC))

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            capability = self._verifier.verify(token)
            assert_mcp_capability_active(capability, self._now())
        except McpCapabilityVerificationError:
            return None
        return AccessToken(
            token=f"verified-capability:{capability.capability_id}",
            client_id=capability.scope.adopter_id,
            scopes=list(capability.allowed_tools),
            expires_at=int(datetime.fromisoformat(capability.expires_at).timestamp()),
            subject=capability.scope.subject_id,
            claims={
                "capabilityId": capability.capability_id,
                "serverId": capability.server_id,
                "allowedTools": list(capability.allowed_tools),
                "scope": {
                    "adopterId": capability.scope.adopter_id,
                    "tenantId": capability.scope.tenant_id,
                    "subjectId": capability.scope.subject_id,
                    "productSessionId": capability.scope.product_session_id,
                    "runtimeSessionId": capability.scope.runtime_session_id,
                    "invocationId": capability.scope.invocation_id,
                    "workflow": capability.scope.workflow,
                },
                "issuedAt": capability.issued_at,
                "expiresAt": capability.expires_at,
            },
        )


def assert_mcp_capability_active(
    capability: VerifiedMcpCapability,
    now: datetime | None = None,
) -> None:
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        raise ValueError("Capability clock must be timezone-aware.")
    expires_at = datetime.fromisoformat(capability.expires_at)
    if current >= expires_at:
        raise McpCapabilityVerificationError()


def _string_claim(
    claims: Mapping[str, Any],
    name: str,
    validator: Callable[[str], str] | None = None,
) -> str:
    value = claims.get(name)
    if not isinstance(value, str):
        raise ValueError(f"Invalid {name} claim.")
    return validator(value) if validator else value


def _integer_claim(claims: Mapping[str, Any], name: str) -> int:
    value = claims.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"Invalid {name} claim.")
    return value


def _epoch_seconds(value: datetime) -> int:
    if value.tzinfo is None:
        raise ValueError("Verifier clock must return a timezone-aware datetime.")
    return int(value.timestamp())


def _iso_timestamp(epoch_seconds: int) -> str:
    return (
        datetime.fromtimestamp(epoch_seconds, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

from __future__ import annotations

from datetime import datetime
from typing import Any

import jwt
import pytest
from mcp.server import MCPServer
from mcp.server.auth.settings import AuthSettings

from heddle_adopter_reference.authority import (
    ExecutionAuthorityConfig,
    ExecutionAuthorityInput,
    ExecutionAuthorityMcpConfig,
    ExecutionScope,
    JoseExecutionAuthority,
    generate_ephemeral_signing_key,
)
from heddle_adopter_reference.contracts import MCP_CAPABILITY_TYPE
from heddle_adopter_reference.errors import McpCapabilityVerificationError
from heddle_adopter_reference.mcp import (
    JwtMcpCapabilityVerifier,
    McpCapabilityVerifierConfig,
    McpSdkCapabilityTokenVerifier,
    StaticJwksProvider,
)


def _build_fixture(
    authority_fixture: dict[str, Any],
) -> tuple[
    JoseExecutionAuthority,
    JwtMcpCapabilityVerifier,
    Any,
    dict[str, Any],
    dict[str, Any],
]:
    execution = authority_fixture["expected"]["executionClaims"]
    mcp = authority_fixture["expected"]["mcpClaims"]
    key = generate_ephemeral_signing_key()
    reference_time = datetime.fromisoformat(authority_fixture["referenceTime"])
    authority = JoseExecutionAuthority(
        ExecutionAuthorityConfig(
            issuer=authority_fixture["issuer"],
            adopter_id=execution["adopterId"],
            execution_audience=authority_fixture["executionAudience"],
            key_id=authority_fixture["keyId"],
            execution_ttl_seconds=300,
            mcp=ExecutionAuthorityMcpConfig(
                audience=authority_fixture["mcpAudience"],
                server_id=mcp["serverId"],
                ttl_seconds=600,
            ),
        ),
        key,
        now=lambda: reference_time,
        create_capability_id=lambda: mcp["jti"],
    )
    verifier = JwtMcpCapabilityVerifier(
        McpCapabilityVerifierConfig(
            issuer=authority_fixture["issuer"],
            audience=authority_fixture["mcpAudience"],
            trusted_adopter_id=execution["adopterId"],
            server_id=mcp["serverId"],
            supported_tools=authority_fixture["supportedTools"],
            max_capability_age_seconds=900,
            clock_tolerance_seconds=0,
        ),
        StaticJwksProvider(authority.public_jwks()),
        now=lambda: reference_time,
    )
    return authority, verifier, key, execution, mcp


def _input(execution: dict[str, Any], mcp: dict[str, Any]) -> ExecutionAuthorityInput:
    return ExecutionAuthorityInput(
        scope=ExecutionScope(
            tenant_id=execution["tenantId"],
            subject_id=execution["sub"],
            product_session_id=execution["productSessionId"],
        ),
        runtime_session_id=execution["runtimeSessionId"],
        invocation_id=execution["jti"],
        allowed_tools=mcp["allowedTools"],
    )


def test_independently_verifies_scope_and_adapts_to_official_mcp_sdk(
    authority_fixture: dict[str, Any],
) -> None:
    authority, verifier, _, execution, mcp = _build_fixture(authority_fixture)
    issued = authority.issue(_input(execution, mcp))
    capability = verifier.verify(issued.mcp_capability())

    assert capability.scope.tenant_id == execution["tenantId"]
    assert capability.scope.runtime_session_id == execution["runtimeSessionId"]
    assert capability.allowed_tools == tuple(mcp["allowedTools"])


@pytest.mark.asyncio
async def test_official_mcp_adapter_redacts_the_bearer(
    authority_fixture: dict[str, Any],
) -> None:
    authority, verifier, _, execution, mcp = _build_fixture(authority_fixture)
    issued = authority.issue(_input(execution, mcp))
    adapter = McpSdkCapabilityTokenVerifier(
        verifier,
        now=lambda: datetime.fromisoformat(authority_fixture["referenceTime"]),
    )

    access_token = await adapter.verify_token(issued.mcp_capability())
    assert access_token is not None
    assert issued.mcp_capability() not in access_token.model_dump_json()
    assert access_token.scopes == mcp["allowedTools"]
    assert access_token.claims["scope"]["tenantId"] == execution["tenantId"]

    server = MCPServer(
        name="python-adopter-reference",
        token_verifier=adapter,
        auth=AuthSettings(
            issuer_url=authority_fixture["issuer"],
            resource_server_url="https://mcp.example.test",
        ),
    )
    assert server is not None


@pytest.mark.parametrize("case_id", ["expired", "unsupported-tool"])
def test_rejects_invalid_shared_capability_cases(
    authority_fixture: dict[str, Any],
    case_id: str,
) -> None:
    authority, verifier, key, _, mcp = _build_fixture(authority_fixture)
    test_case = next(item for item in authority_fixture["invalidMcpCases"] if item["id"] == case_id)
    claims = {**mcp, **test_case["overrides"]}
    token = jwt.encode(
        claims,
        key,
        algorithm="ES256",
        headers={
            "alg": "ES256",
            "kid": authority_fixture["keyId"],
            "typ": MCP_CAPABILITY_TYPE,
        },
    )

    with pytest.raises(McpCapabilityVerificationError):
        verifier.verify(token)


def test_shared_swapped_scope_breaks_execution_to_capability_binding(
    authority_fixture: dict[str, Any],
) -> None:
    _, _, _, execution, mcp = _build_fixture(authority_fixture)
    test_case = next(
        item
        for item in authority_fixture["invalidMcpCases"]
        if item["id"] == "swapped-runtime-session"
    )
    swapped = {**mcp, **test_case["overrides"]}
    shared_fields_match = (
        execution["adopterId"] == swapped["adopterId"]
        and execution["tenantId"] == swapped["tenantId"]
        and execution["productSessionId"] == swapped["productSessionId"]
        and execution["runtimeSessionId"] == swapped["runtimeSessionId"]
        and execution["workflow"] == swapped["workflow"]
        and execution["sub"] == swapped["sub"]
        and execution["jti"] == swapped["invocationId"]
    )
    assert shared_fields_match is False

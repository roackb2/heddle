from __future__ import annotations

from datetime import datetime

import jwt

from heddle_adopter_reference.authority import (
    ExecutionAuthorityConfig,
    ExecutionAuthorityInput,
    ExecutionAuthorityMcpConfig,
    ExecutionScope,
    JoseExecutionAuthority,
    generate_ephemeral_signing_key,
    metadata_json,
)
from heddle_adopter_reference.contracts import (
    EXECUTION_ASSERTION_TYPE,
    MCP_CAPABILITY_TYPE,
)
from heddle_adopter_reference.mcp import StaticJwksProvider


def test_issues_the_shared_claim_vector_without_serializing_credentials(
    authority_fixture: dict[str, object],
) -> None:
    expected = authority_fixture["expected"]
    execution = expected["executionClaims"]  # type: ignore[index]
    mcp = expected["mcpClaims"]  # type: ignore[index]
    private_key = generate_ephemeral_signing_key()
    authority = JoseExecutionAuthority(
        ExecutionAuthorityConfig(
            issuer=authority_fixture["issuer"],  # type: ignore[arg-type]
            adopter_id=execution["adopterId"],
            execution_audience=authority_fixture["executionAudience"],  # type: ignore[arg-type]
            key_id=authority_fixture["keyId"],  # type: ignore[arg-type]
            execution_ttl_seconds=300,
            mcp=ExecutionAuthorityMcpConfig(
                audience=authority_fixture["mcpAudience"],  # type: ignore[arg-type]
                server_id=mcp["serverId"],
                ttl_seconds=600,
            ),
        ),
        private_key,
        now=lambda: datetime.fromisoformat(authority_fixture["referenceTime"]),  # type: ignore[arg-type]
        create_capability_id=lambda: mcp["jti"],
    )
    issued = authority.issue(
        ExecutionAuthorityInput(
            scope=ExecutionScope(
                tenant_id=execution["tenantId"],
                subject_id=execution["sub"],
                product_session_id=execution["productSessionId"],
            ),
            runtime_session_id=execution["runtimeSessionId"],
            invocation_id=execution["jti"],
            allowed_tools=mcp["allowedTools"],
        )
    )
    public_key = StaticJwksProvider(authority.public_jwks()).resolve(
        authority_fixture["keyId"]  # type: ignore[arg-type]
    )

    assert (
        jwt.decode(
            issued.execution_assertion(),
            public_key,
            algorithms=["ES256"],
            issuer=authority_fixture["issuer"],
            audience=authority_fixture["executionAudience"],
            options={"verify_exp": False},
        )
        == execution
    )
    assert (
        jwt.decode(
            issued.mcp_capability(),
            public_key,
            algorithms=["ES256"],
            issuer=authority_fixture["issuer"],
            audience=authority_fixture["mcpAudience"],
            options={"verify_exp": False},
        )
        == mcp
    )
    assert jwt.get_unverified_header(issued.execution_assertion())["typ"] == (
        EXECUTION_ASSERTION_TYPE
    )
    assert jwt.get_unverified_header(issued.mcp_capability())["typ"] == MCP_CAPABILITY_TYPE

    rendered = f"{issued!r}\n{metadata_json(issued)}"
    assert issued.execution_assertion() not in rendered
    assert issued.mcp_capability() not in rendered
    assert "d" not in authority.public_jwks()["keys"][0]


def test_mcp_is_optional_and_must_be_deployment_configured() -> None:
    key = generate_ephemeral_signing_key()
    authority = JoseExecutionAuthority(
        ExecutionAuthorityConfig(
            issuer="https://api.example.test",
            adopter_id="example-adopter",
            execution_audience="urn:execution",
            key_id="key-001",
            execution_ttl_seconds=300,
        ),
        key,
    )
    input_value = ExecutionAuthorityInput(
        scope=ExecutionScope(
            tenant_id="tenant-a",
            subject_id="subject-a",
            product_session_id="session-a",
        ),
        runtime_session_id=f"runtime-session:{'a' * 40}",
        invocation_id="invocation-001",
    )
    assert authority.issue(input_value).mcp_capability() is None

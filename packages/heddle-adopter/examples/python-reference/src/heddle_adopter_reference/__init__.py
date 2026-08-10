"""Language-neutral Heddle Execution Host adopter reference."""

from .authority import (
    ExecutionAuthorityConfig,
    ExecutionAuthorityInput,
    ExecutionAuthorityMcpConfig,
    ExecutionScope,
    JoseExecutionAuthority,
    generate_ephemeral_signing_key,
)
from .errors import (
    ExecutionHostProtocolError,
    ExecutionHostRejectedError,
    ExecutionHostStreamInterruptedError,
    McpCapabilityVerificationError,
)
from .http_sse import (
    DirectHttpExecutionHost,
    ExecutionHostConversationTurn,
)
from .mcp import (
    JwtMcpCapabilityVerifier,
    McpCapabilityVerifierConfig,
    McpSdkCapabilityTokenVerifier,
    StaticJwksProvider,
    assert_mcp_capability_active,
)

__all__ = [
    "DirectHttpExecutionHost",
    "ExecutionAuthorityConfig",
    "ExecutionAuthorityInput",
    "ExecutionAuthorityMcpConfig",
    "ExecutionHostConversationTurn",
    "ExecutionHostProtocolError",
    "ExecutionHostRejectedError",
    "ExecutionHostStreamInterruptedError",
    "ExecutionScope",
    "JoseExecutionAuthority",
    "JwtMcpCapabilityVerifier",
    "McpCapabilityVerifierConfig",
    "McpCapabilityVerificationError",
    "McpSdkCapabilityTokenVerifier",
    "StaticJwksProvider",
    "assert_mcp_capability_active",
    "generate_ephemeral_signing_key",
]

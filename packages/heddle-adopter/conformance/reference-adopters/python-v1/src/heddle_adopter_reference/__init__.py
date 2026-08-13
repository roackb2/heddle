"""Language-neutral Heddle Execution Host adopter reference."""

from .authority import (
    ExecutionAuthorityConfig,
    ExecutionAuthorityInput,
    ExecutionAuthorityMcpConfig,
    JoseExecutionAuthority,
    generate_ephemeral_signing_key,
)
from .contracts import ExecutionScope
from .errors import (
    ExecutionHostInvocationCancelledError,
    ExecutionHostProtocolError,
    ExecutionHostRejectedError,
    ExecutionHostStreamInterruptedError,
    McpCapabilityVerificationError,
)
from .http_sse import (
    DirectHttpExecutionHost,
    ExecutionHostConversationTurn,
)
from .lifecycle import (
    DurableHostedConversationTurnService,
    HostedConversationAcceptedTurn,
    HostedConversationExpiredTurnReconciliation,
    HostedConversationRequestedTurn,
    HostedConversationTerminalOutcome,
    HostedConversationTerminalProjection,
    HostedConversationTurnIdentity,
    HostedConversationTurnInput,
    HostedConversationTurnLifecycleRecord,
    HostedConversationTurnLifecycleStore,
    HostedConversationTurnRunner,
    HostedConversationTurnSettlement,
    interrupt_expired_hosted_conversation_turns,
    project_hosted_conversation_terminal_event,
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
    "DurableHostedConversationTurnService",
    "ExecutionAuthorityConfig",
    "ExecutionAuthorityInput",
    "ExecutionAuthorityMcpConfig",
    "ExecutionHostConversationTurn",
    "ExecutionHostInvocationCancelledError",
    "ExecutionHostProtocolError",
    "ExecutionHostRejectedError",
    "ExecutionHostStreamInterruptedError",
    "ExecutionScope",
    "HostedConversationAcceptedTurn",
    "HostedConversationExpiredTurnReconciliation",
    "HostedConversationRequestedTurn",
    "HostedConversationTerminalOutcome",
    "HostedConversationTerminalProjection",
    "HostedConversationTurnIdentity",
    "HostedConversationTurnInput",
    "HostedConversationTurnLifecycleRecord",
    "HostedConversationTurnLifecycleStore",
    "HostedConversationTurnRunner",
    "HostedConversationTurnSettlement",
    "JoseExecutionAuthority",
    "JwtMcpCapabilityVerifier",
    "McpCapabilityVerifierConfig",
    "McpCapabilityVerificationError",
    "McpSdkCapabilityTokenVerifier",
    "StaticJwksProvider",
    "assert_mcp_capability_active",
    "generate_ephemeral_signing_key",
    "interrupt_expired_hosted_conversation_turns",
    "project_hosted_conversation_terminal_event",
]

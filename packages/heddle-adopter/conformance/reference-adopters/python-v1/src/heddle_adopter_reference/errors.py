"""Stable, credential-free public failures for the Python reference."""


class ExecutionHostProtocolError(Exception):
    """The host returned a malformed or inconsistent v1 stream."""


class ExecutionHostStreamInterruptedError(Exception):
    """The stream ended without a terminal event; completion is unknown."""


class ExecutionHostInvocationCancelledError(Exception):
    """The local caller cancelled the invocation."""


class ExecutionHostRejectedError(Exception):
    """The host rejected an invocation before accepting its stream."""

    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(f"Execution Host rejected the invocation ({status_code}, {code}).")
        self.status_code = status_code
        self.code = code


class McpCapabilityVerificationError(Exception):
    """The bearer is invalid for this adopter MCP deployment."""

    def __init__(self) -> None:
        super().__init__("MCP capability verification failed.")

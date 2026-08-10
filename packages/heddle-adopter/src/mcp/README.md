# MCP capability verification

This module independently verifies an adopter-issued, invocation-scoped MCP
capability at the adopter backend's MCP edge. Verification binds issuer,
audience, adopter, MCP server, lifetime, invocation identity, product scope,
and an exact subset of deployment-supported tool names. The immutable verified
projection—not model arguments or forwarded identity headers—should authorize
product tool dispatch. Recheck expiry before every operation with
`assertMcpCapabilityActive()`.

This verifier is intentionally separate from Execution Host admission. The
host's earlier verification is defense in depth and cannot replace product-edge
verification. The module does not register MCP tools, host an MCP transport,
look up domain data, or decide what each authenticated subject may do.

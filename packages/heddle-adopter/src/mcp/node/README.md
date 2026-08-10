# Node Streamable HTTP MCP edge

This optional subpath owns the generic official-SDK server lifecycle around
adopter product tools: bounded JSON, bearer extraction/redaction, independent
capability verification, safe HTTP/JSON-RPC errors, one stateless server and
transport per request, cancellation, and shutdown.

The injected `NodeMcpToolset` owns every model-visible tool name, description,
schema, annotation, handler, and product operation. Tool handlers must derive
identity from `context.capability.scope`, never model-controlled arguments, and
should call `assertMcpCapabilityActive` again immediately before sensitive or
long-running operations.

The service does not register its own route, authenticate product users, select
the signed allowlist, read a database, or decide product authorization. Those
remain adopter responsibilities.

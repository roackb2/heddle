# Node Streamable HTTP MCP edge

This optional subpath owns the generic official-SDK server lifecycle around
adopter product tools: bounded JSON, bearer extraction/redaction, independent
capability verification, safe HTTP/JSON-RPC errors, one stateless server and
transport per request, cancellation, and shutdown.

For the common JSON-tool path, use `NodeMcpJsonToolset` with declarations made
through `defineNodeMcpJsonTool`. The generic registry exposes exactly the names
in the signed capability, combines request and operation cancellation, checks
capability lifetime before and after product work, serializes results as JSON,
and replaces thrown errors with each declaration's static public failure text.
The adopter declares only product names, descriptions, Zod input schemas,
annotations, and behavior. Handlers derive identity from
`context.capability.scope`, never model-controlled arguments.

The lower-level `NodeMcpToolset` remains the advanced escape hatch for custom
MCP content, non-JSON results, or product-specific lifecycle behavior. In that
mode the adopter owns allowlist enforcement and repeated lifetime checks.

The service does not register its own route, authenticate product users, select
the signed allowlist, read a database, or decide product authorization. Those
remain adopter responsibilities.

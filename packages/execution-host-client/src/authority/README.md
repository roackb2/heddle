# Execution authority

This module owns the reference ES256 machinery for issuing one short-lived
Execution Host admission assertion and, when configured, one separately scoped
product-MCP capability. The adopter ID, audiences, MCP destination, key ID, and
token lifetimes come from deployment configuration—not untrusted request or
model input. The caller supplies identity only after product authentication and
authorization have resolved the tenant, subject, product session, runtime
session, and durable invocation ID.

`JoseExecutionAuthority` verifies that its public and private keys match,
publishes only public JWK fields, uses separate token types/audiences/JTIs, and
keeps compact JWTs behind explicit accessors. JSON serialization is
credential-free, but its identifiers can still be sensitive product data.

This module does not load or rotate signing keys, serve the JWKS endpoint,
authenticate users, allocate runtime sessions, or durably prevent invocation
replay. Those responsibilities stay in the adopter backend and its deployment.

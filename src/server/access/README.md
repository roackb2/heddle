# Server request access

This service owns the authentication and authorization boundary for the
reference control-plane HTTP server.

- Product hosts authenticate requests and return a typed principal plus an
  allow-listed workspace/session scope.
- Heddle intersects client-supplied IDs with that resolved scope for both tRPC
  and REST routes.
- Hosts may add operation-specific authorization after Heddle's static scope
  check.
- Approval and cancellation routes write actor-aware audit events to the
  workspace operation log and may forward them to a host audit sink.

This service does not own login, cookies, bearer-token verification, tenant
membership, role assignment, identity-provider configuration, or audit-log
retention. Those remain product responsibilities.

Local mode intentionally authenticates no one and permits every local
workspace/session. It is for a single-operator daemon only and is not safe as a
hosted or multi-tenant deployment mode.

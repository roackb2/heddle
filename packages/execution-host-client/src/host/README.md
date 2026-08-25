# Execution Host authority verification

This subpath owns the reusable verification half of Heddle's signed Execution
Host boundary. It verifies adopter-issued execution assertions and optional MCP
capabilities, then binds both credentials to the exact Runtime session,
invocation, workflow, and product scope admitted by the host.

The deployable Execution Host still owns HTTP ingress, local authentication,
Runtime-session isolation, model credentials, Heddle composition, streaming,
and provider bootstrap. Adopters still own signing keys, identity selection,
authorization, and capability issuance.

The product MCP edge uses `../mcp` instead. Its verifier derives scope from a
capability for product data access; this module independently cross-checks that
same capability against the host's verified execution identity.

The provider-neutral Runtime session service under `runtime-session/` owns
immutable scope binding, one-active-invocation admission, workflow dispatch,
deadlines, cancellation, bounded duplicate suppression, status, and shutdown.
Provider ingress, process isolation, health projection, engine composition, and
deployment bootstrap remain responsibilities of the deployable host.

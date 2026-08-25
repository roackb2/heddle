# Execution Host Client v6.5.0

`@heddleagent/execution-host-client@6.5.0` moves reusable Execution Host-side
authority verification into the public package. Compatible host
implementations no longer need private copies of the JOSE verification and
invocation-binding rules.

## What changed

- add `@heddleagent/execution-host-client/host` with execution-identity and
  MCP-capability verifier ports, schemas, errors, and JOSE implementations;
- bind each execution assertion to the exact Runtime session, invocation, and
  workflow admitted by the host;
- bind each MCP capability to the independently verified product scope and
  invocation before forwarding it to the product MCP edge; and
- share remote-JWKS cache and unavailable-error classification across both
  host-side and product MCP-edge verification.

## Ownership boundary

The package owns portable credential verification and signed-scope binding.
The deployable Execution Host still owns HTTP ingress, Runtime-session
isolation, model credentials, Heddle composition, streaming, provider
bootstrap, configuration, and deployment. Products still own signing keys,
identity and authorization decisions, capability issuance, product data, and
the independently verified MCP edge.

## Publication

Publish manually from the tagged release commit. This repository does not
automatically publish packages from `main`.

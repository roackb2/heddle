# Execution Host Client v6.3.0

`@heddleagent/execution-host-client@6.3.0` separates execution-authority
issuance from public-key publication so a product can grant one coordinator
run without exposing or reimplementing the broader authority service.

## What changed

- add the narrow `ExecutionAuthorityIssuer` interface with the existing
  `issue(...)` operation;
- keep `ExecutionAuthority` as the full issuer plus public-JWKS authority;
- let conversation and heartbeat delegation depend only on issuance when that
  is the capability they need; and
- preserve the existing JWT claims, workflow contracts, and wire behavior.

This release does not add a coordinator service, persistence implementation,
deployment workflow, or new authority format. Products still own authenticated
scope and authorization; the coordinator receives one short-lived delegated
authority rather than a signing key.

## Publication

Publish manually from the reviewed release commit. This repository does not
automatically publish packages from `main`.

# Heddle adopter conformance

This directory proves that the published Execution Host contract can be
implemented independently of the supported TypeScript adopter SDK.

The ownership order is:

1. `../spec/v1/` is the normative language-neutral contract and golden data.
2. `../src/` is the supported TypeScript SDK and reference implementation.
3. `reference-adopters/python-v1/` is one clean-room consumer proof pinned to
   contract v1. It implements the optional durable lifecycle because that
   profile is normative, not merely because TypeScript has a helper. It is not
   a Python SDK and does not promise general feature parity with `src/`.

## When a reference adopter changes

| Change | Python v1 work |
| --- | --- |
| TypeScript or Node ergonomic helper | None |
| Framework, key-storage, testing, or deployment utility | None |
| AgentCore, AWS, or another provider binding | None |
| Optional behavior already expressible by v1 | Add a golden case only when it proves a new interoperability invariant |
| Required v1 request, identity, capability, stream, terminal, or security semantic | Update the normative artifacts, fixtures, TypeScript conformance, and Python v1 proof together |
| Required durable-lifecycle transition, projection, or safety semantic | Update the durable profile, shared golden fixture, TypeScript implementation, and Python v1 proof together |
| New workflow, transport, or incompatible semantic | Make an explicit contract-version decision; do not silently grow Python v1 |

Do not add another reference language, generated-client matrix, framework
starter, or adopter gateway without a real adopter exposing a concrete gap in
the canonical artifacts and Python proof.

# `@heddleagent/runtime` 7.1.1

This patch release tightens hosted Runtime integration points for products that embed Heddle with their own evidence windows, tool authorization, and event persistence.

## What changed

- Add typed external-context contracts for hosted `web_search` and `view_image` tools, including published input/output schemas and output validation.
- Let hosts compose the external-context toolkit with request-scoped provider credentials, stable tool definitions, and host-authorized opaque image references.
- Add `ViewImageResourceResolver` and resource metadata checks so embedding products can resolve image bytes directly without temporary-file handoff logic.
- Add `ViewImageToolOptions.defaultPrompt` so hosts can provide a bounded fallback prompt for image inspection while preserving Heddle's coding-assistant default when omitted.
- Add `ViewImageToolOptions.sourcePolicy` with `paths-only`, `references-only`, and `paths-and-references` modes so hosts can narrow the model-visible schema and execution validation to the locator kinds they authorize.
- Serialize agent-loop event delivery in emission order so asynchronous host event sinks do not observe terminal events before earlier trace or activity events have settled.

## Upgrade and workflow notes

Existing callers keep the previous local-path `view_image` behavior by default. Hosts that pass a `resourceResolver` keep path-plus-reference behavior unless they explicitly opt into `sourcePolicy: 'references-only'`.

Products with a frozen evidence window should use `references-only` and keep authorization in their resolver. Heddle enforces disabled locator kinds at the public JSON-parameter and execution-validation boundaries, while the host still owns which references are valid and how bytes are read.

## Verification

The release candidate was verified with the repository build and test baseline, Runtime package build, npm dry-run packaging, focused external-context coverage, and release-range review from `runtime-v7.1.0` through the shipped commit.

# Tool Policy Envelope

This domain owns the shared model-facing policy envelope that can be attached
to tool calls. Toolkits own their business input schemas; this domain owns the
common `policy` field so every environment-touching tool can expose the same
low-friction intent contract without duplicating schema fragments.

## Owns

- The shared `ToolPolicyEnvelope` type.
- The JSON-schema fragment for the `policy` field.
- Central schema augmentation for object-shaped tool parameters.
- Input extraction that separates the envelope from tool business input before
  execution.
- Reconciliation between model-proposed intent and host-owned execution facts.

## Does Not Own

- Approval policy decisions. Those belong to `src/core/approvals`.
- Tool-specific input interpretation. Those belong to the relevant toolkit.
- Trace persistence. Trace events consume the same domain objects but do not
  define this shape.

## Boundary Rule

Agents report intent through this envelope. The runtime may use it as a policy
claim, but it must not treat it as verified fact. A host that owns a tool can
attach immutable authority, transport, target-environment, and effect
classification through `ToolDefinition.hostPolicy` or
`ToolDefinition.resolveHostPolicy(...)`.

Policy evaluation keeps three views rather than collapsing their provenance:

- `modelProposed`: the model-authored intent envelope;
- `hostOwned`: immutable execution facts supplied by the tool owner;
- `effective`: the reconciled envelope consumed by approval policy.

The reconciliation record also identifies which source owns each field and
records normalization diagnostics. This lets approval traces explain why a
model claim was overridden without copying tool business arguments into the
trace.

The envelope is deliberately shared across tools. It gives the agent one stable
vocabulary for "what I am trying to do" while each tool keeps its own business
arguments. The tools domain exposes and removes the envelope; approvals decide
whether the claim is allowed.

The agent should use the envelope to honestly declare the purpose and expected
impact surface of the operation: operation categories, target roots, read/write
roots, expected effects, environment, destructive scope, and confidence. The
harness combines that declaration with runtime environment facts and configured
policy before deciding whether to allow, request approval, or deny the action.

## Envelope Shape

```ts
type ToolPolicyEnvelope = {
  operations: Array<'read' | 'write' | 'delete' | 'move' | 'execute' | 'git' | 'network' | 'unknown'>;
  intent: string;
  targetRoots: string[];
  readRoots?: string[];
  writeRoots?: string[];
  expectedEffects: string[];
  maxDestructiveScope?: 'none' | 'single-file' | 'generated-files' | 'many-files';
  environment: 'local' | 'dev' | 'staging' | 'production' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
};
```

Field meanings:

- `operations`: all operation classes the agent expects the call to perform.
  This is an array because real work often combines actions, such as
  `execute + write` for a migration script. `network` describes a network
  effect for an ordinary host tool; it is not a synonym for an MCP HTTP
  transport. MCP transport is host-owned provenance.
- `intent`: short natural-language explanation of why the tool call exists.
- `targetRoots`: project/workspace roots involved in the work.
- `readRoots`: optional narrower project/workspace roots when read and write
  scopes differ.
- `writeRoots`: optional narrower project/workspace roots when the call mutates
  files.
- `expectedEffects`: concise effect claims useful for approval UI and trace.
- `maxDestructiveScope`: expected upper bound of destructive change.
- `environment`: where the operation is expected to act.
- `confidence`: how certain the agent is that the declaration is complete.

A root is a project/workspace boundary, usually a git repository root or a
folder with project config such as `package.json`, `requirements.txt`,
`pyproject.toml`, `Cargo.toml`, `go.mod`, or similar. Agents should use the
narrowest project root involved, not an individual file path. For example,
reading `src/core/tools/registry.ts` should normally claim `targetRoots: ["."]`,
not `targetRoots: ["src/core/tools/registry.ts"]`.

## Example Tool Inputs

Read-only inspection can declare only read intent:

```json
{
  "path": "src/core/tools/registry.ts",
  "policy": {
    "operations": ["read"],
    "intent": "Inspect the tool registry before wiring policy envelope support.",
    "targetRoots": ["."],
    "readRoots": ["."],
    "expectedEffects": ["no files changed"],
    "maxDestructiveScope": "none",
    "environment": "local",
    "confidence": "high"
  }
}
```

A free-form shell mutation can declare multiple operations and a sibling repo
scope without forcing the tool schema to understand the shell command:

```json
{
  "command": "node scripts/rewrite-imports.js ../heddle-workspace-notes",
  "policy": {
    "operations": ["execute", "write"],
    "intent": "Run a local migration script that updates markdown import paths in the sibling notes repo.",
    "targetRoots": ["../heddle-workspace-notes"],
    "readRoots": ["../heddle-workspace-notes"],
    "writeRoots": ["../heddle-workspace-notes"],
    "expectedEffects": ["many markdown files may be edited"],
    "maxDestructiveScope": "many-files",
    "environment": "local",
    "confidence": "medium"
  }
}
```

A cleanup can describe delete plus git effects together:

```json
{
  "command": "rm generated/*.tmp && git add generated",
  "policy": {
    "operations": ["delete", "git"],
    "intent": "Remove generated temporary files and stage the generated folder.",
    "targetRoots": ["generated"],
    "writeRoots": ["generated"],
    "expectedEffects": ["generated temporary files deleted", "generated folder staged"],
    "maxDestructiveScope": "generated-files",
    "environment": "local",
    "confidence": "medium"
  }
}
```

## Runtime Flow

The model sees augmented schemas from `ToolRegistry.list()`. The executable
tool definitions returned by `ToolRegistry.get(...)` stay unchanged.

```text
ToolRegistry.list()
  -> ToolPolicyEnvelopeSchemaService.addToTool(...)
  -> model sees optional policy field

ToolExecutionService.execute(...)
  -> ToolPolicyEnvelopeInputService.extract(...)
  -> validate and remove policy
  -> execute raw tool with stripped business input

AutonomyPolicyService.evaluate(...)
  -> ToolPolicyResolutionService.resolve(...)
  -> retain modelProposed + hostOwned
  -> normalize transport claims and apply host environment/effects
  -> evaluate the effective envelope
```

Approval code also extracts the envelope before building previews and approval
requests. Tool implementations should not receive or inspect `policy`; it is
intent metadata for approval, trace, and future postflight auditing.

The model-facing envelope schema is strict. Unsupported top-level policy fields
such as `authority`, `transport`, or tenant provenance are rejected before tool
execution with an actionable diagnostic. The model cannot silently redefine
host-owned facts.

## Relationship To Autonomy

`src/core/approvals/autonomy/` consumes this shape directly. It compares the
agent's declared intent and host facts with configured roots, known tool
targets, command hard-deny patterns, and environment policy. Trace records the
same reconciliation object, including the proposed, host-owned, and effective
views.

Do not create a second "trace envelope" or "approval envelope" with the same
fields. If a consumer needs less data, project from this type at that consumer's
presentation boundary.

## Maintenance Rules

- Keep the envelope optional so ordinary tools remain lightweight.
- Add fields only when they are useful across tool families, not for one tool's
  private needs.
- Keep tool-specific validation in the toolkit that owns the tool.
- Keep server identity, transport, environment, tenant, and verified effect
  classification host-owned. Never infer authorization from model input.
- Keep approval decisions in `src/core/approvals`, not here.
- Keep extraction centralized in `ToolPolicyEnvelopeInputService` so tools,
  approvals, and tests agree on the stripped input shape.
- Update `src/__tests__/unit/tools/tool-policy-envelope.test.ts` when changing
  schema injection, validation, or stripping behavior.

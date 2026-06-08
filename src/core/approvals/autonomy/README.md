# Approval Autonomy

This domain owns Heddle's autopilot approval policy semantics.

Autonomy is the approval layer for long-running agent work. Its job is to let
the agent keep moving without asking for every tool call while still enforcing
basic runtime-owned safety boundaries. It is not a sandbox and it is not a
replacement for deterministic tool validation. It combines:

- user-configured policy roots;
- the agent's declared intent envelope;
- runtime-computed facts from the tool call; and
- hard-deny rules for destructive operations that should never run unattended.

## Owns

- Normalized autopilot root profiles.
- Agent-declared policy envelope evaluation.
- Runtime-computed autonomy facts.
- Allow/request/deny decisions for unattended tool calls.
- Policy hints that help future sessions tune config after a blocked run.

## Does Not Own

- Tool schema injection or envelope extraction. That belongs to
  `src/core/tools/policy-envelope`.
- Tool execution.
- Pending approval UI or browser/TUI presentation.
- Remembered project approval storage.

## Boundary Rule

The agent's envelope is a claim. The autonomy policy uses it as the declared
scope contract for ambiguous tools, but deterministic hard-deny rules and
configured root policy remain runtime-owned.

The harness must not fully trust the claim, but it also must not block every
free-form shell command only because static parsing is incomplete. For shell
commands and scripts, the envelope is the agent's explicit contract about the
intended operation class, roots, environment, destructive scope, and confidence.
Autonomy evaluates that contract against configured roots and hard-deny facts.

## Example Profile

Profiles are intentionally small. A profile answers: which roots may run
unattended, which capabilities are allowed there, which roots must remain
manual, and which environments may proceed without approval.

```ts
const profile: AutopilotProfile = {
  mode: 'autopilot',
  roots: [
    {
      path: '.', // current Heddle checkout, resolved relative to workspace root
      access: 'autopilot',
      allow: [
        'read',
        'write',
        'execute',
        'simple-delete',
        'many-file-edit',
        'verification',
        'formatting',
        'dependency',
        'git-stage',
      ],
    },
    {
      path: '../heddle-workspace-notes',
      access: 'autopilot',
      allow: ['read', 'write', 'simple-delete', 'many-file-edit'],
    },
    {
      path: '~',
      access: 'manual-only',
    },
    {
      path: '/Volumes',
      access: 'deny',
    },
  ],
  environments: {
    allow: ['local', 'dev'],
    requireApproval: ['staging', 'production', 'unknown'],
  },
};
```

Access levels:

- `read`: only read claims can run unattended.
- `write`: write-like claims may run unattended only when the listed
  capabilities allow them.
- `autopilot`: the root is eligible for unattended work, still constrained by
  capabilities.
- `manual-only`: matching calls request approval.
- `deny`: matching calls are denied before approval fallback.

Capabilities are intentionally coarse. They are policy vocabulary, not a full
filesystem permission system. For example, `simple-delete` can allow a
single-file delete, while `many-file-edit` is required for broad replacements or
many-file deletion/edit scopes.

## Agent Intent Envelope

Every agent-callable tool can expose the same optional `policy` field through
`src/core/tools/policy-envelope`. Tool-specific input remains owned by the tool;
the envelope is shared product vocabulary for autonomy and trace.

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

`operations` is an array on purpose. Real coding work often combines actions:
running a formatter can be `execute` plus `write`; a broad migration script may
be `execute` plus `write`; a cleanup may be `delete` plus `git`. Forcing the
agent to collapse the call into one operation makes the declaration less useful
and slows the agent down.

Example shell mutation claim:

```json
{
  "command": "node scripts/rewrite-imports.js ../heddle-workspace-notes",
  "policy": {
    "operations": ["execute", "write"],
    "intent": "Run a local migration script that rewrites note imports in the sibling notes repo.",
    "targetRoots": ["../heddle-workspace-notes"],
    "writeRoots": ["../heddle-workspace-notes"],
    "expectedEffects": ["many markdown files may be updated"],
    "maxDestructiveScope": "many-files",
    "environment": "local",
    "confidence": "medium"
  }
}
```

The shell command is still free-form. The policy does not try to prove every
effect from static parsing. Instead, it checks whether the declared roots,
operation classes, destructive scope, environment, and hard-deny facts are
compatible with the profile.

## Decision Flow

`AutonomyPolicyService.evaluate(...)` produces one `AutonomyEvaluation`.
Downstream trace and approval code should pass that shape through directly
instead of redefining similar fields.

```text
Tool call with optional policy envelope
  -> ToolPolicyEnvelopeInputService.extract(...)
  -> AutopilotProfileService.normalize(...)
  -> AutonomyPolicyService.computeFacts(...)
  -> AutonomyPolicyService.decide(...)
  -> ToolApprovalPolicies.autopilot(...)
  -> allow | request approval | deny
  -> AutonomyTraceService.decision(...) records the same AutonomyEvaluation
```

The service currently computes:

- declared operations, read roots, and write roots;
- known tool targets such as `path`, `from`, and `to`;
- root decisions for each claimed or known target;
- hard-deny reasons from root policy and dangerous command patterns;
- approval reasons for unconfigured roots, manual-only roots, insufficient
  capabilities, non-local environments, network claims, and low-confidence or
  unknown claims;
- policy hints that explain how the user could tune the profile after a block.

Decision rules:

- `deny`: hard-denied root, root/home recursive delete, workspace-wide
  recursive delete, wildcard recursive delete, privilege escalation, hard git
  reset, force push, disk formatting, device writes, or `terraform destroy`.
- `request`: missing envelope for approval-gated mutating tools,
  `unknown`/low-confidence intent, disallowed environment, manual-only root,
  unconfigured root, missing capability, or network operation.
- `allow`: profile is in `autopilot` mode, the envelope is specific enough, all
  roots are configured, capabilities match, environment is allowed, and no
  hard-deny or approval reason is present.

## Trace Contract

Autonomy trace exists so later sessions can understand why a long-running agent
was blocked and how policy should be adjusted. Trace events should wrap the
domain object:

- `autonomy.decision` contains `AutonomyEvaluation`;
- `autonomy.postflight` contains `AutonomyPostflightAudit`.

Do not create a trace-only shape that renames the same fields. If another layer
needs less data for display, project it at the presentation boundary. The core
trace should keep the agent envelope, computed facts, decision, reason, and
policy hints together.

## Maintenance Rules

- Add policy logic in `AutonomyPolicyService`, not in hosts or tool
  implementations.
- Add profile normalization/default behavior in `AutopilotProfileService`.
- Add or change the shared envelope only in `src/core/tools/policy-envelope/`.
- Keep tool execution using stripped tool input; the `policy` field is intent
  metadata, not part of the tool's business input.
- Keep trace shapes consistent with the domain types.
- Add service tests for policy changes before wiring UI/config behavior.

## Current Limits

This service is the core policy foundation. Workspace/user profile loading,
user-facing yolo controls, and postflight effect auditing are follow-up slices.
The existing `AutonomyPostflightAudit` type reserves the downstream shape so the
future implementation can record observed effects without inventing a second
trace vocabulary.

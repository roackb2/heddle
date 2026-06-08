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
- Auto profile root expansion when a user approves a detected sibling repo.
- Policy hints that help future sessions tune config after a blocked run.

## Does Not Own

- Tool schema injection or envelope extraction. That belongs to
  `src/core/tools/policy-envelope`.
- Tool execution.
- Pending approval UI or browser/TUI presentation.
- Remembered project approval storage.
- Host-specific approval button layout or keyboard shortcuts.

## Boundary Rule

The agent's envelope is a claim. The autonomy policy uses it as the declared
scope contract for ambiguous tools, but deterministic hard-deny rules and
configured root policy remain runtime-owned.

The harness must not fully trust the claim, but it also must not block every
free-form shell command only because static parsing is incomplete. For shell
commands and scripts, the envelope is the agent's explicit contract about the
intended operation class, roots, environment, destructive scope, and confidence.
Autonomy evaluates that contract against configured roots and hard-deny facts.

## How The Model Fits Together

There is one policy object at decision time: the effective `AutopilotProfile`.
Mode/config fields are only inputs for building that profile.

User-facing mental model:

```text
Auto = agent can do normal local coding work by itself in trusted repos.
Trusted repos = current repo + repos the user explicitly trusted.
Dangerous or unclear actions still stop.
```

The approval UI should teach that model with `Approve once`, `Trust this repo`,
and `Deny`. Avoid presenting `autoTrustedRoots` or the hand-authored
`autopilot` profile as concepts users need to understand for ordinary Auto use.

```text
permissionMode: default
  -> no effective AutopilotProfile
  -> normal approval behavior

permissionMode: auto
  -> generated Auto profile
  -> plus autoTrustedRoots
  -> effective AutopilotProfile { preset: "auto" }

permissionMode: custom
  -> hand-authored config.autopilot
  -> effective AutopilotProfile { preset: "custom" or unset legacy custom }
```

`autoTrustedRoots` is not a second approval system. It is stored config for
expanding the generated Auto preset:

```json
{
  "permissionMode": "auto",
  "autoTrustedRoots": ["../heddle-workspace-notes"]
}
```

At runtime, `AutonomyPermissionModeService.resolveEffectiveProfile(...)`
produces:

```ts
{
  mode: 'autopilot',
  preset: 'auto',
  roots: [
    { path: '.', access: 'autopilot', source: 'generated-working-root' },
    { path: '../heddle-workspace-notes', access: 'autopilot', source: 'user-trusted-repo' },
    { path: homedir(), access: 'manual-only', source: 'safety-default' },
    { path: '/Volumes', access: 'deny', source: 'safety-default' },
    { path: '/dev', access: 'deny', source: 'safety-default' },
  ],
}
```

The evaluator only consumes that final profile. It does not separately inspect
`permissionMode`, `autoTrustedRoots`, or UI approval choices.

For each tool call:

```text
tool call
  -> strip optional agent policy envelope
  -> infer or read operation claims
  -> resolve known target paths such as path/from/to
  -> match each target to the most specific profile root
  -> hard-deny checks
  -> envelope requirement checks for approval-gated tools
  -> root/capability/environment checks
  -> allow | request approval | deny
```

Examples:

```text
read_file ../heddle-workspace-notes/foo.md
  -> matches ../heddle-workspace-notes
  -> access: autopilot
  -> read capability allowed
  -> allow

read_file ~/Downloads/foo.txt
  -> matches homedir()
  -> access: manual-only
  -> request approval

read_file /dev/something
  -> matches /dev
  -> access: deny
  -> deny
```

Per-request approval is the escape valve when a call is not allowed
unattended, but is also not hard-denied:

- `approve once`: resolve this pending tool call only; profile/config do not
  change.
- `Trust this repo`: add the detected repo root to `autoTrustedRoots`,
  update the active in-memory Auto profile, then resume the pending tool call.
- remembered project approvals: legacy exact/project approvals for repeated
  command or edit requests; they are separate from Auto root expansion and
  should not be presented as the primary repo-trust model.

Auto remains Auto after repo expansion. Adding `autoTrustedRoots` means the user
expanded the trusted root set for Heddle's Auto preset. Custom means the user
owns the whole hand-authored `autopilot` profile.

## Example Profile

Profiles are intentionally small. A profile answers: which roots may run
unattended, which capabilities are allowed there, which roots must remain
manual, and which environments may proceed without approval.

```ts
const profile: AutopilotProfile = {
  mode: 'autopilot',
  preset: 'auto',
  roots: [
    {
      path: '.', // current Heddle checkout, resolved relative to workspace root
      access: 'autopilot',
      source: 'generated-working-root',
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
      source: 'user-trusted-repo',
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

## Permission Modes

`AutonomyPermissionModeService` owns the product mapping from user-facing
permission modes to effective autonomy profiles. Hosts should not build their
own profile templates or reinterpret mode names.

- `default`: no autopilot profile is active. Heddle uses the normal approval
  flow.
- `auto`: Heddle uses the generated local coding profile. It allows read,
  write, execute, simple delete, many-file edit, verification, formatting,
  dependency, and git-stage capabilities under the current workspace root and
  any user-approved Auto roots while keeping the home directory manual-only and
  denying device/volume roots.
- `custom`: Heddle uses the workspace's hand-authored `autopilot` profile.
  This is selectable only when a hand-authored profile exists with
  `mode: "autopilot"` and differs from Heddle's generated Auto profile. An
  `autopilot` block with `mode: "interactive"` is default approval behavior,
  not Custom. The full custom profile editor is a later UI/TUI slice.

Project config stores `permissionMode` separately from the hand-authored
`autopilot` profile. This lets a user switch Default/Auto/Custom without
deleting a custom profile. Auto-specific user expansions live in
`autoTrustedRoots`, not in the custom `autopilot` object:

```json
{
  "permissionMode": "auto",
  "autoTrustedRoots": ["../heddle-workspace-notes"]
}
```

`AutonomyPermissionModeService.resolveEffectiveProfile(...)` converts that
config into one concrete `AutopilotProfile` with `preset: "auto"`. Downstream
approval policy does not read `autoTrustedRoots` directly.

## Approval-Driven Auto Expansion

When Auto is active and a tool targets an unconfigured or manual-only sibling
repo, `AutonomyRootScopeService` may detect the nearest repo/project root using
markers such as `.git`, `package.json`, `pyproject.toml`, `requirements.txt`,
`Cargo.toml`, or `go.mod`. The pending approval request can then include an
`autopilotRootApproval` option.

Root detection is intentionally bounded. It searches from the target path only
up to, but not including, the active workspace's parent directory. For example,
from `/ProjectHeddle/heddle` it can detect `/ProjectHeddle/heddle-workspace-notes`,
but it must not promote `/ProjectHeddle`, `$HOME`, or `/` into Auto.

If the user chooses "Trust this repo", the control-plane approval
resolver calls:

```ts
AutonomyPermissionModeService.trustAutoRoot({
  config,
  workspaceRoot,
  root: detectedRepoRoot,
});
```

and mutates the active in-memory Auto profile through:

```ts
AutonomyPermissionModeService.addTrustedRootToProfile({
  profile,
  workspaceRoot,
  root: detectedRepoRoot,
});
```

The result remains Auto, not Custom. Auto means Heddle owns the policy preset;
the user can expand the trusted root set, but capabilities still come from the
Auto template and hard-deny/manual roots still win. Custom means the user owns a
hand-authored `autopilot` profile.

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
  unconfigured root, missing capability, or network operation. Root checks run
  even for read/list/search calls that do not require an envelope.
- `allow`: profile is in `autopilot` mode, all roots are configured,
  capabilities match, environment is allowed when an envelope is present, and
  no hard-deny or approval reason is present.

## Trace Contract

Autonomy trace exists so later sessions can understand why a long-running agent
was blocked and how policy should be adjusted. Trace events should wrap the
domain object:

- `autonomy.decision` contains `AutonomyEvaluation`;
- `autonomy.postflight` contains `AutonomyPostflightAudit`.

Postflight audit runs only after an unattended autopilot allow decision. The
agent dispatcher passes the original `AutonomyEvaluation` and tool result into
`AutonomyPostflightAuditService`, then records the returned audit through
`AutonomyTraceService.postflight(...)`.

The audit intentionally uses structured effects the runtime can see:

- first-class file tools can report changed paths from their structured output;
- shell-like tools usually report only command metadata, so postflight can flag
  known git-history mutation commands but cannot prove every filesystem effect;
- if structured changed paths exceed declared write roots, the audit decision is
  `stop` and the tool result returned to the agent is converted into a
  postflight failure.

Do not create a trace-only shape that renames the same fields. If another layer
needs less data for display, project it at the presentation boundary. The core
trace should keep the agent envelope, computed facts, decision, reason, and
policy hints together.

## Maintenance Rules

- Add policy logic in `AutonomyPolicyService`, not in hosts or tool
  implementations.
- Add profile normalization/default behavior in `AutopilotProfileService`.
- Add post-execution observed-effect logic in
  `AutonomyPostflightAuditService`.
- Add or change the shared envelope only in `src/core/tools/policy-envelope/`.
- Keep tool execution using stripped tool input; the `policy` field is intent
  metadata, not part of the tool's business input.
- Keep trace shapes consistent with the domain types.
- Add service tests for policy changes before wiring UI/config behavior.

## Current Limits

This service is the core policy foundation. Workspace config may provide a
`permissionMode` and optional `autopilot` profile through `.heddle/config.json`;
project-config validates the persisted shape, and control-plane request context
passes the resolved effective profile into this approval policy. Postflight
audit now records observed structured effects after unattended autopilot
execution. Richer custom profile editing and richer shell
effect observation remain follow-up slices.

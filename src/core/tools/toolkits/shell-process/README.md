# Shell Process Toolkit

The shell-process toolkit owns policy-classified shell command execution for
`run_shell_inspect` and `run_shell_mutate`.

## Owns

- Command policy classification into scope, risk, and capability metadata
  (`shell-policy.ts`).
- Blocked shell control operators for the inspect tool.
- A catastrophic-command guard that applies even to the approval-gated tool.
- Child process spawn, output collection, timeout, and abort handling
  (`run-shell.ts`).
- The structured result shape: `command`, `exitCode`, `stdout`, `stderr`, and
  the `policy` decision.

## What This Boundary Actually Guarantees

Be precise about this. The toolkit provides **command-shape policy plus human
approval**. It does not provide operating-system isolation.

A command executed by either tool:

- runs through the host shell (`spawn(cmd, { shell: true })`) with the **full
  authority of the host user account** that started Heddle;
- starts in the workspace directory, which is its **initial working directory
  only** — it can `cd`, use absolute paths, and read or write anywhere the host
  user can;
- inherits the parent process environment, including credentials present there;
- can reach the network without restriction; and
- is bounded only by a 30-second timeout and a 1 MiB per-stream output ceiling.

The `scope: 'workspace'` value in a policy decision is a **classification of
what the command appears to do**, not an enforced containment claim. Nothing in
this toolkit confines a command to the workspace root.

By contrast, the coding-files toolkit does enforce canonical containment for
its direct file operations. Shell and direct file tools therefore have
genuinely different boundaries, and neither README should be read as covering
the other. See `../coding-files/README.md`.

Hosts running untrusted or model-directed workloads should place the whole
Heddle process inside mature OS isolation (a container, a VM, or a
least-privilege user account). Approval is a human-judgment gate, not a
technical containment mechanism.

## Two Tools, Two Gates

| Tool | Policy | Approval | Control operators |
|---|---|---|---|
| `run_shell_inspect` | `DEFAULT_INSPECT_RULES`, unknown commands rejected | none | read-only pipes allowed; redirects, chaining, backgrounding, and subshells blocked |
| `run_shell_mutate` | `DEFAULT_MUTATE_RULES`, unknown commands allowed and marked `risk: 'unknown'` | `requiresApproval: true` | permitted, including inline scripts and heredocs |

Inspect is a narrow, non-approval path. Mutate is the arbitrary-command path
and depends entirely on approval for its safety.

## Does Not Own

- Approval UI, remembered approval rules, or autonomy policy. Those live in
  `src/core/approvals/`.
- Direct file read/write/move/delete containment. That is the coding-files
  toolkit's `WorkspacePathPolicy`.
- Process-tree supervision. Cancellation and timeout signal the spawned shell,
  not necessarily its descendants.
- Environment construction or secret filtering for hosted profiles.
- Any OS sandbox, container, or virtual-machine backend.

## Known Limits

These are current, deliberate limits — documented rather than silently implied:

- **Descendant processes may survive.** `child.kill()` targets the spawned
  shell. A backgrounded or forked descendant is not guaranteed to be reaped on
  timeout or abort.
- **SIGKILL escalation is unreliable.** The escalation path is guarded by
  `child.killed`, which Node sets once a signal has been delivered, so the
  follow-up SIGKILL after SIGTERM generally does not fire.
- **Output is truncated from the head.** Each stream retains only the last
  1 MiB; earlier output is discarded without a marker in the result.
- **The timeout is fixed** at 30 seconds and is not host-configurable.

Addressing these belongs to complete process-tree supervision, not to command
policy. Do not fix them by adding a second execution path beside this one.

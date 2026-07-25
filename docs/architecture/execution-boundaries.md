# Execution Boundaries

This document states what Heddle's execution boundaries actually enforce today,
and inventories every production process launcher and model-directed filesystem
path so future work can tell containment from convention.

It is descriptive, not aspirational. If an entry here becomes wrong, the code
changed and this document must change with it.

## The Honest Summary

Heddle runs as **one ordinary host process with the full authority of the user
account that started it**. It has:

- a *logical* project namespace — workspace roots, session scopes, state
  directories, and configuration that keep projects from colliding; and
- *policy and approval* gates — command classification, approval prompts, and
  canonical path containment for direct file tools.

It does **not** have an operating-system isolation boundary. There is no
sandbox, container, seccomp profile, or per-project user account. A command the
operator approves can read any file, reach any network destination, and use any
credential the host user can.

Approval is a human-judgment gate. Path policy is defense in depth. Neither is
containment in the OS sense, and no Heddle surface should imply otherwise.

Hosts that run untrusted or fully model-directed workloads should place the
whole Heddle process inside mature OS isolation.

## Enforcement By Tool Family

| Family | Path containment | Approval | Notes |
|---|---|---|---|
| `coding-files` (read, list, search, edit, create, delete, move) | **Canonical** via `WorkspacePathPolicy` — `realpath` for existing targets, canonical nearest-existing-parent for new ones, both endpoints for moves | mutations approval-gated | Symlink escape is closed. TOCTOU races are not. |
| `run_shell_inspect` | **None.** Workspace is the initial `cwd` only | none — policy allowlist only | Read-oriented rules; redirects, chaining, subshells blocked |
| `run_shell_mutate` | **None.** Workspace is the initial `cwd` only | `requiresApproval: true` | Arbitrary commands permitted once approved |
| `edit_memory_note` | **Canonical** — reuses `executeScopedEdit` with the memory root | mutation approval-gated | Same core as coding-files |
| `read`/`search`/`list` memory notes | **Lexical only** — see gap below | none | `MemoryPathUtils.resolveMemoryPath` |
| MCP tools | delegated to the server | host-owned policy, remote mutations approval-gated | Out of scope for this document |

The `scope: 'workspace'` value in a shell policy decision classifies what a
command *appears* to do. It is not an enforcement claim.

## Process Launcher Inventory

Every production `spawn`/`exec*` call site, and whether the command string can
be influenced by the model.

### Model-influenced command content

| Site | Mechanism | Shell interpretation | Gate |
|---|---|---|---|
| `core/tools/toolkits/shell-process/run-shell.ts:162` | `spawn(cmd, { shell: true })` | **yes** | Command policy; approval for mutate |
| `core/memory/note-service.ts:166` | `spawn('rg' \| 'grep', argv)` | no | Query is model-supplied but passed as argv, not interpolated |
| `core/tools/toolkits/coding-files/search-files.ts` (6 sites) | `execFileSync('rg', argv)` | no | Search root resolved through `WorkspacePathPolicy` first |

`run-shell.ts` is the only production launcher that interprets a shell string.
Everything else uses argv arrays, so a model-supplied value cannot become a new
command.

### Fixed-command launchers

| Site | Command | Purpose |
|---|---|---|
| `core/awareness/domains/coding/collectors/git.ts:310` | `git` | Read-only awareness collection |
| `server/controllers/trpc/control-plane/workspace-diff.ts:285` | `git` | Diff projection |
| `server/controllers/trpc/control-plane/workspace-files.ts:110,136` | `git ls-files` / `rev-parse` | File suggestions |
| `core/auth/openai-oauth.ts:384` | platform browser opener | OAuth login |
| `core/browser/native-chrome/service.ts:140` | Chrome launch command | Browser control plane |
| `server/services/control-plane/slash-command-execution-context-service.ts:185` | `open`/`xdg-open`/`start` | Open a file in the default application |
| `cli-v2/services/notifications/terminal-notification-service.ts:85` | `/usr/bin/osascript` | Desktop notification |
| `core/eval/process.ts:26` | eval-case command | Eval harness; operator-authored cases only |

These take operator- or host-supplied arguments rather than model-authored
command strings. `slash-command-execution-context-service.ts` and
`native-chrome/service.ts` both spawn detached and intentionally outlive the
request.

## Identified Gaps

These are real findings from this audit. None are fixed by this document.

### 1. Memory note reads use lexical containment while memory edits use canonical

`MemoryPathUtils.resolveMemoryPath` (`core/memory/path-utils.ts:5`) checks
containment with `resolve` + `relative` + a `..` prefix test. That is a purely
lexical check: a symlink inside the memory root that points outside it resolves
to an in-root relative path and passes.

`edit_memory_note` is unaffected because it routes through `executeScopedEdit`,
which canonicalizes. But `read`, `search`, and `list` go through
`MemoryNoteService.resolvePath` and do not. The same tool family therefore has
two different containment strengths.

The fix is to route memory path resolution through the same canonical policy
the coding-files toolkit already owns — not to add a second path checker.

### 2. Shell cancellation does not supervise the process tree

`run-shell.ts` signals the spawned shell only. A backgrounded or forked
descendant is not guaranteed to be reaped on timeout or abort.

### 3. SIGKILL escalation is effectively dead code

Both `run-shell.ts:188` and `core/eval/process.ts:34` guard the follow-up
SIGKILL with `if (!child.killed)`. Node sets `child.killed` to `true` once a
signal has been *delivered*, not once the process has exited, so after the
SIGTERM the guard is already false and the SIGKILL does not fire. A process
that ignores SIGTERM survives both the timeout and the abort path.

### 4. Shell output truncates from the head without a marker

Each stream keeps only the last 1 MiB. Earlier output is dropped silently, so a
model cannot tell truncated output from complete output.

### 5. The shell timeout is fixed

30 seconds, not host-configurable, with no per-profile override.

Gaps 2–5 belong to complete local process-tree supervision. Gap 1 belongs to
canonical path enforcement. Neither should be addressed by introducing a
parallel execution backend or a second path-policy implementation.

## What Would Change These Guarantees

A future execution-profile boundary could add OS sandboxes, containers, or
stronger isolation backends. Until a concrete second backend and a production
call path exist, Heddle should not add a sandbox abstraction — an abstraction
with one implementation and an aspirational second is not a boundary, it is a
wrapper.

When such a backend does arrive, this document's Honest Summary is the thing
that must be rewritten first.

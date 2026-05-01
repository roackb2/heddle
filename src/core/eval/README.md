# Heddle Agent Evals

This directory contains the implementation for Heddle's live agent evaluation harness.

The eval harness is meant to answer a product question that unit tests cannot answer by themselves: did a prompt, runtime, tool, approval, or host-behavior change make Heddle better or worse as a coding agent?

## Case And Result Layout

```text
evals/
  cases/
    coding/
      smoke/      # cheap harness-smoke cases
      dogfood/    # realistic pinned Heddle-on-Heddle cases
  results/        # generated local reports, gitignored
```

Default `yarn eval:agent` runs only the smoke cases so expensive dogfood cases do not run by accident.

## Common Commands

Use the package scripts below as the standard entrypoints. Avoid mixing these with
`yarn cli:dev eval ...` in docs or handoff notes unless you are debugging the CLI
dispatcher itself.

Run the default smoke suite:

```bash
yarn eval:agent
```

Dry-run the default smoke suite without calling a model:

```bash
yarn eval:agent --dry-run
```

Run one smoke case:

```bash
yarn eval:agent --case fix-failing-test
```

Run a pinned dogfood case:

```bash
yarn eval:agent --cases-dir evals/cases/coding --case heddle-post-mutation-empty-requirement --model gpt-5.4
```

Run the milestone-style dogfood case:

```bash
yarn eval:agent --cases-dir evals/cases/coding --case heddle-shared-chat-runtime-milestone --model gpt-5.4
```

Run the broader Phase B TUI-adapter dogfood case:

```bash
yarn eval:agent --cases-dir evals/cases/coding --case heddle-phase-b-tui-adapter-milestone --model gpt-5.4
```

Run the same Phase B scenario against the moving `HEAD` target:

```bash
yarn eval:agent --cases-dir evals/cases/coding --case heddle-phase-b-tui-adapter-milestone-head --model gpt-5.4
```

Write results to a specific folder:

```bash
yarn eval:agent --output evals/results/my-run --case fix-failing-test
```

Preview cleanup of old result directories:

```bash
yarn eval:clean
```

Delete result directories modified before a cutoff:

```bash
yarn eval:clean --before 2026-05-01T00:00:00Z --yes
```

## Reading A Report

Each run writes:

```text
evals/results/agent-YYYY-MM-DD-HHMMSS/
  report.md
  report.json
  current/<case-id>/
    stdout.txt
    stderr.txt
    progress.jsonl
    git-status.txt
    diff.patch
    diff-stat.txt
    changed-files.json
    result.json
    session-catalog.json
    traces/
```

`diff.patch`, `diff-stat.txt`, and `changed-files.json` include untracked files,
so newly created tests and modules should show up in the report instead of only
appearing in `git-status.txt`.

For smoke cases, the report mostly proves the harness is working.

For dogfood and milestone cases, treat `passed` as "deterministic post-run checks passed", not "the work was definitely high quality." Use the report's milestone review section, changed files, diff, trace metrics, final summary, and human review questions to decide whether the agent completed the intended task or stopped after a substep.

## Case Types

### Smoke Cases

Smoke cases are intentionally small. They validate:

- workspace setup
- agent invocation
- deterministic checks
- artifact collection
- report writing
- trace analysis

They are not a serious benchmark for Heddle's product quality.

### Dogfood Cases

Dogfood cases run against a real Heddle worktree pinned to a fixed ref.

Pinned target refs are important. The evaluated Heddle runtime can change between baseline and candidate runs, but the target workspace should stay fixed. Avoid using moving `HEAD` for comparable evals.

Example fixture:

```json
{
  "fixture": {
    "type": "git-worktree",
    "repo": ".",
    "ref": "v0.0.37"
  }
}
```

Moving-target `HEAD` cases are useful for exploratory dogfooding against the
latest code, but do not use them as the primary baseline for A/B comparison.
For comparable behavior measurement, keep the target fixture pinned and compare
candidate Heddle runtimes against the same case and ref.

## Progress Output

Long-running evals print phase progress to stdout and write the same events to `progress.jsonl`.

Example:

```text
[heddle-shared-chat-runtime-milestone] started: run Heddle agent (0ms)
[heddle-shared-chat-runtime-milestone] heartbeat: still running Heddle agent (30s)
[heddle-shared-chat-runtime-milestone] completed: run Heddle agent (74s)
```

This makes it easier to distinguish a live long-running eval from a stuck setup command.

## Implementation Map

```text
schema.ts             # eval case and report data model
case-loader.ts        # JSON case loading
workspace-fixture.ts  # inline and pinned git-worktree workspace setup
agent-runner.ts       # per-case live agent execution
check-runner.ts       # deterministic post-run checks
git-artifacts.ts      # diff, status, changed-files, trace/session copying
trace-analyzer.ts     # trace-derived behavior metrics
progress.ts           # stdout progress and progress.jsonl
report-writer.ts      # Markdown and JSON suite reports
cleanup.ts            # eval result cleanup command
```

## Harness Reliability Rules

The eval harness is the QA layer for agent behavior. Keep it more conservative than ordinary scripts:

- Add tests for schema and report changes.
- Keep generated artifacts inside the result directory.
- Separate deterministic pass/fail checks from human quality judgment.
- Pin dogfood target refs for comparable runs.
- Prefer small, reviewable harness changes before adding larger benchmark cases.

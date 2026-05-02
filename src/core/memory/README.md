# Memory

The memory domain owns Heddle-managed durable knowledge: candidate capture,
cataloged note maintenance, visibility APIs, and memory-specific system
guidance.

## Owns

- Memory catalog bootstrapping and validation.
- Memory domain prompt and retrieval/recording rules.
- Knowledge candidate records and maintenance runs.
- Maintainer-mode execution over pending candidates.
- Memory maintenance integration after chat turns.
- Memory note templates and slug generation.
- Host-facing memory visibility helpers.

## Does Not Own

- General chat session persistence.
- Low-level agent loop mechanics.
- UI rendering for memory status or notes.
- General file tools outside memory-specific note access.
- Provider credential resolution.

## Public Entry Points

- `catalog.ts`: catalog bootstrap, load, append system context, and validation.
- `domain-prompt.ts`: memory-specific system context.
- `maintainer.ts`: pending candidate reading and maintenance execution.
- `maintenance-integration.ts`: run maintenance for candidates recorded in a
  trace.
- `maintainer-tools.ts`: tools used by maintainer mode.
- `visibility.ts`: memory status, list, read, and search views for hosts.
- `templates.ts`: memory note templates.

## Extension Points

- Add durable memory policy by updating domain prompt, candidate validation, and
  maintainer tests together.
- Add host visibility through `visibility.ts`; keep host rendering outside this
  domain.
- Add new memory trace summaries through the observability/trace summarizer path
  once it exists.

## Common Changes

- To change what should be remembered, update `domain-prompt.ts`, relevant tools,
  and memory integration tests.
- To change catalog invariants, update `catalog.ts`, validation tests, and
  maintainer tests.
- To change maintenance concurrency or locking, update
  `maintenance-integration.ts` and integration coverage.

## Tests

- `src/__tests__/integration/memory/memory-catalog.test.ts`
- `src/__tests__/integration/memory/memory-integration.test.ts`
- `src/__tests__/integration/memory/memory-maintainer.test.ts`
- `src/__tests__/integration/memory/memory-visibility.test.ts`
- `src/__tests__/integration/tools/tools.test.ts`

## Notes For Coding Agents

- Memory is a durable knowledge domain, not scratch context.
- Live workspace evidence wins over memory for implementation facts.
- Do not store secrets, speculative guesses, or one-turn command output.


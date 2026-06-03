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

- `types.ts`: memory-domain contracts for catalogs, candidates, runs, visibility,
  validation, and note operations.
- `schemas.ts`: zod validation for persisted memory JSONL records and locks.
- `catalog.ts`: `MemoryCatalogService` owns catalog bootstrap, root catalog
  loading, startup system-context assembly, and required catalog shape.
- `domain-prompt.ts`: memory-specific system context.
- `maintenance-repository.ts`: `MemoryMaintenanceRepository` owns candidate,
  run, status, and lock file persistence.
- `maintainer.ts`: `MemoryMaintenanceService` owns pending candidate reads and
  agent-backed maintenance execution.
- `maintainer-prompt.ts`: `MemoryMaintainerPrompt` owns static maintainer
  instructions and dynamic candidate/catalog prompt assembly. Keep static text
  before dynamic memory content for provider token caching.
- `maintenance-integration.ts`: `MemoryMaintenanceIntegrationService` owns
  trace-triggered maintenance scheduling, locking, and lifecycle events.
- `note-service.ts`: `MemoryNoteService` owns note list/read/search/edit
  behavior. Tool adapters should call this service, not duplicate file logic.
- `maintainer-tools.ts`: tools used by maintainer mode.
- `visibility.ts`: `MemoryVisibilityService` owns host-facing status and note
  visibility views.
- `validation.ts`: `MemoryValidationService` owns workspace health checks and
  safe missing-catalog repair.
- `templates.ts`: pure memory note template helpers.

## Command-Facing Service Contract

Terminal command edges may call these public methods directly:

- `MemoryCatalogService.bootstrap()`: create the required catalog/template shape.
- `MemoryVisibilityService.loadStatus()`: build the status view for
  `heddle memory status`.
- `MemoryVisibilityService.listNotePaths/readNote/searchNotes`: expose
  read-only note visibility. Command edges should not traverse memory files
  themselves.
- `MemoryValidationService.validate()` and `repairMissingCatalogs()`: validate
  and safely repair missing catalog files.
- `MemoryMaintenanceService.readPendingCandidates()` and `runBacklog()`: inspect
  and process pending durable knowledge candidates.

Command edges own only argument parsing, explicit provider credential selection
for maintainer runs, and terminal formatting. They must not duplicate catalog
shape checks, note path validation, pending-candidate filtering, lock handling,
or maintainer semantics.

## Extension Points

- Add durable memory policy by updating domain prompt, candidate validation, and
  maintainer tests together.
- Add host visibility through `visibility.ts`; keep host rendering outside this
  domain.
- Add new memory trace summaries through the observability/trace summarizer path
  once it exists.
- Add persisted memory records by updating `types.ts`, `schemas.ts`, and the
  owning repository together.

## Common Changes

- To change what should be remembered, update `domain-prompt.ts`, relevant tools,
  and memory integration tests.
- To change catalog invariants, update `catalog.ts`, validation tests, and
  maintainer tests.
- To change maintenance concurrency or locking, update
  `maintenance-integration.ts` and integration coverage.
- To change note access, update `MemoryNoteService`; keep knowledge tools as
  adapters over that service.

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
- Keep domain behavior inside the memory service/repository classes. Pure prompt
  text, templates, and tool composition can remain small helper modules.
- Do not make memory visibility call memory tools. The dependency direction is
  tools and hosts -> memory services.

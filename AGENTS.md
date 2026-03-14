# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/`, with the agent loop in `run-agent.ts`, tool contracts under `tools/`, trace helpers in `trace/`, LLM adapters in `llm/`, and shared types in `types.ts`. Tests stay beside the codebase in `src/__tests__`, while runnable examples (such as `repo-investigator.ts`) sit in `examples/` for quick prototyping. Use `local/` for scratch traces, API keys, or per-developer config—everything there is gitignored, so treat it as your personal workspace.

## Build, Test & Development Commands
- `yarn dev` runs the repo-investigator loop via `tsx`, piping logs to the console—use it to validate tool wiring quickly.
- `yarn build` compiles TypeScript to `dist/` and doubles as the canonical type-check.
- `yarn test` executes the Vitest suite headlessly; add `--runInBand` if parallelism obscures failures.

## Coding Style & Naming Conventions
The project is strict TypeScript targeting ES2022 with `nodenext` modules. Use 2-space indentation, keep files in lower-hyphen case (`run-agent.ts`), and prefer explicit named exports. CamelCase functions/variables, PascalCase types/interfaces, and snake_case tool identifiers mirror existing usage. There is no autoformatter in the toolchain, so rely on `tsc` and reviewer feedback to maintain consistent spacing and imports.

## Testing Guidelines
Write Vitest specs beside the current smoke test, naming files `*.test.ts`. Favor behavior-level tests that exercise the agent loop, registry, trace recorder, and any new tool abstraction. When adding tools or utilities, assert both the happy path and failure budget handling, and capture representative trace events so regressions surface quickly. Ensure `yarn test` passes locally before opening a PR; add fixtures under `local/` if you need bespoke data but never commit those artifacts.

## Commit & Pull Request Guidelines
History shows short imperative summaries (e.g., "Project scaffold"), so keep commit subjects under ~72 characters and describe "what" + "why" in the body if needed. Each PR should include: goal-oriented description, linked issue or ticket, testing notes (`yarn test`, `yarn dev` output), and screenshots or trace snippets when behavior visibly changes. Flag any tooling or dependency updates explicitly, and request reviews from runtime + tooling maintainers when touching `run-agent.ts` or shared types.

## Security & Configuration Tips
OpenAI keys and other secrets belong in your shell environment or `.env` files ignored by git. Never log real credentials; redact traces before sharing externally. If you capture production traces or logs, store them in `local/` and scrub them prior to uploading to issues.

# CLI V2 Slash Commands

`src/cli-v2/services/commands` owns terminal prompt slash commands for the
Ink-based cli-v2 surface.

These are terminal prompt commands, not backend/core commands. Command effects
must route through the cli-v2 control-plane store, the shared control-plane API
service, or existing `src/client-shared` surfaces. Do not import the old TUI
from `src/cli/chat`, core services, server controllers, or backend DTO modules
from this folder.

Keep this domain narrow until cli-v2 has more command behavior to own. Add
commands here when they are terminal-specific prompt interactions; move shared
API-result projection to `src/client-shared` only when web-v2 and cli-v2 can
reuse it directly.

## Shape

- `terminal-slash-command-parser.ts`: parses slash command text and provides
  match predicates.
- `terminal-slash-command-registry.ts`: composes command modules, exposes
  hints, and dispatches parsed commands.
- `modules/`: terminal command groups. Add a new command group by creating a
  module factory and registering it in `modules/terminal-command-modules.ts`.
- `terminal-slash-command-service.ts`: cli-v2 store-facing facade for help,
  unknown-command handling, and registry dispatch.

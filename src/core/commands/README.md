# Commands

The commands domain owns text-command parsing, registration, autocomplete, and
cross-host command behavior. Host layers compose command modules into their own
registries and render the command results.

## Owns

- Generic slash-command parser and registry infrastructure.
- Command metadata such as syntax, description, aliases, and hints.
- Cross-host command modules for behavior that is not specific to TUI rendering.
- Slash command result types that adapters can render or execute.

## Does Not Own

- TUI-only commands such as saving an Ink frame snapshot.
- Host input widgets, command palettes, or picker UI.
- Session storage internals, model policy internals, heartbeat stores, or auth
  credential storage. Commands call those through ports.
- Turn execution middleware.

## Current Entry Points

- `slash/types.ts`: command metadata, parsed input, hints, and registry-facing
  generic types.
- `slash/result-types.ts`: `SlashCommandResult`, the command-domain result
  contract.
- `slash/parser.ts`: parse slash command text without treating absolute paths as
  commands.
- `slash/registry.ts`: register and dispatch command modules.
- `slash/autocomplete.ts`: command hints and completions.
- `slash/modules/*`: model, auth, session, compaction, heartbeat, and drift
  command modules.

## Extension Points

- Add a cross-host command by adding a command module and registering it in the
  default command registry.
- Add a host-specific command in the host adapter layer and compose it into the
  registry from that host.
- Add command behavior through typed ports. Do not import TUI state or server
  services directly into core command modules.

## Common Changes

- To add a command, define its syntax/description, parser match behavior, result
  shape, and tests before wiring it into a host.
- To add autocomplete, add it as metadata or a pure helper tied to the command
  module.
- To change slash command behavior, update characterization tests first.

## Tests

- Core parser, registry, and autocomplete:
  `src/__tests__/unit/core/slash-commands.test.ts`
- Core command modules:
  `src/__tests__/unit/core/slash-command-modules.test.ts`
- TUI behavior lock:
  `src/__tests__/unit/tui/local-commands.test.ts`
- TUI command integration: `src/__tests__/integration/tui/session-cli.test.ts`

## Notes For Coding Agents

- Commands are adapters from text to domain operations. They are not the domain
  itself.
- Prefer command arrays and registries over switchboards.
- Keep command modules UI-free unless they live under a host-specific folder.

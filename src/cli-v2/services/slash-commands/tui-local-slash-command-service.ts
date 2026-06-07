import type { ControlPlaneSlashCommandHint } from '@/client-shared/api/types.js';

export type TuiLocalSlashCommandAction = 'activity' | 'diff' | 'commandResults';

export type TuiLocalSlashCommandHandlers = Record<TuiLocalSlashCommandAction, () => void>;

type TuiLocalSlashCommandDefinition = {
  action: TuiLocalSlashCommandAction;
  commands: string[];
  description: string;
};

/**
 * Owns slash-style commands whose entire effect is cli-v2 terminal presentation.
 *
 * Put a command here only when it operates on Ink-local UI state that another
 * host cannot observe or rely on: expanding a disclosure row, opening a focused
 * terminal review panel, or toggling a terminal-only result view. These commands
 * may reuse slash syntax for discoverability, but they are not shared command
 * semantics and must not require a control-plane API call to complete.
 *
 * Put a command in the core/control-plane slash registry when it affects shared
 * session, runtime, model, auth, heartbeat, compaction, or workspace behavior,
 * or when web-v2/programmatic hosts should see the same command and result.
 * If a future command needs both shared effects and TUI presentation changes,
 * keep the shared operation in core/control-plane and let cli-v2 react to the
 * returned state instead of moving core policy into this service.
 */
export class TuiLocalSlashCommandService {
  private static readonly definitions: TuiLocalSlashCommandDefinition[] = [
    {
      action: 'activity',
      commands: ['/a', '/activity'],
      description: 'toggle terminal activity details',
    },
    {
      action: 'diff',
      commands: ['/d', '/diff'],
      description: 'open terminal diff review',
    },
    {
      action: 'commandResults',
      commands: ['/c', '/commands'],
      description: 'toggle terminal command output',
    },
  ];

  static hints(): ControlPlaneSlashCommandHint[] {
    return TuiLocalSlashCommandService.definitions.flatMap((definition) => (
      definition.commands.map((command) => ({ command, description: definition.description }))
    ));
  }

  static execute(command: string, handlers: TuiLocalSlashCommandHandlers): boolean {
    const normalized = command.trim().toLowerCase();
    const definition = TuiLocalSlashCommandService.definitions
      .find((candidate) => candidate.commands.includes(normalized));

    if (!definition) {
      return false;
    }

    handlers[definition.action]();
    return true;
  }
}

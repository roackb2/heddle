import { matchesAnyExactSlashCommand, matchesExactSlashCommand } from '../../parser.js';
import type { SlashCommandModule } from '../../types.js';
import type { CoreSlashCommandResult, SlashCommandExecutionContext } from '../context.js';
import { slashMessageResult } from '../results.js';

export function createDriftSlashCommandModule(): SlashCommandModule<CoreSlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'drift',
    hints: [
      { command: '/drift', description: 'show CyberLoop semantic drift detection status' },
      { command: '/drift on', description: 'enable CyberLoop semantic drift detection for chat runs' },
      { command: '/drift off', description: 'disable CyberLoop semantic drift detection' },
    ],
    commands: [
      {
        id: 'drift.status',
        syntax: '/drift',
        aliases: ['/drift status'],
        description: 'show CyberLoop semantic drift detection status',
        match: matchesAnyExactSlashCommand(['/drift', '/drift status']),
        run: (context) => {
          const status = context.drift.status();
          return slashMessageResult(formatDriftStatus(status.enabled, status.error));
        },
      },
      {
        id: 'drift.enable',
        syntax: '/drift on',
        description: 'enable CyberLoop semantic drift detection for chat runs',
        match: matchesExactSlashCommand('/drift on'),
        run: (context) => {
          context.drift.setEnabled(true);
          return slashMessageResult('Enabled CyberLoop semantic drift detection for chat runs. Heddle will load real CyberLoop kinematics middleware and write annotations into traces.');
        },
      },
      {
        id: 'drift.disable',
        syntax: '/drift off',
        description: 'disable CyberLoop semantic drift detection',
        match: matchesExactSlashCommand('/drift off'),
        run: (context) => {
          context.drift.setEnabled(false);
          return slashMessageResult('Disabled CyberLoop semantic drift detection.');
        },
      },
    ],
  };
}

export function formatDriftStatus(enabled: boolean, error: string | undefined): string {
  if (!enabled) {
    return 'CyberLoop drift detection is disabled. Use /drift on to enable observe-only kinematics telemetry.';
  }

  return error ?
      `CyberLoop drift detection is enabled but unavailable: ${error}`
    : 'CyberLoop drift detection is enabled. The footer shows drift=unknown|low|medium|high, and traces include cyberloop.annotation events.';
}

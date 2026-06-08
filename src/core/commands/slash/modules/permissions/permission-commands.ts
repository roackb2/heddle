import type { AutonomyPermissionMode } from '@/core/approvals/index.js';
import { AUTONOMY_PERMISSION_MODES } from '@/core/approvals/index.js';
import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';

export const PERMISSIONS_SET_HELP_MESSAGE = 'Use /permissions set <query> to filter permission modes, then use arrows and Enter to choose one.';

export function createPermissionsSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'permissions',
    hints: [
      { command: '/permissions', description: 'show the active permission mode' },
      { command: '/permissions set [query]', description: 'pick permission mode with filtering' },
      { command: '/permissions <default|auto|custom>', description: 'set the workspace permission mode' },
    ],
    commands: [
      {
        id: 'permissions.current',
        syntax: '/permissions',
        description: 'show the active permission mode',
        match: SlashCommandParser.matchesExact('/permissions'),
        run: (context) => slashMessageResult(`Current permission mode: ${context.permissions.current()}`),
      },
      {
        id: 'permissions.set.help',
        syntax: '/permissions set',
        description: 'pick permission mode with filtering',
        match: SlashCommandParser.matchesExact('/permissions set'),
        run: () => slashMessageResult(PERMISSIONS_SET_HELP_MESSAGE),
      },
      {
        id: 'permissions.set',
        syntax: '/permissions <default|auto|custom>',
        description: 'set the workspace permission mode',
        match: SlashCommandParser.matchesPrefix('/permissions'),
        run: (context, input) => setPermissionMode(context, argumentAfterPrefix(input, '/permissions')),
      },
    ],
  };
}

function setPermissionMode(
  context: SlashCommandExecutionContext,
  value: string,
): SlashCommandResult {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return slashMessageResult(`Current permission mode: ${context.permissions.current()}`);
  }

  const selected = normalized.startsWith('set ') ? normalized.slice('set '.length).trim() : normalized;
  if (!isPermissionMode(selected)) {
    return slashMessageResult('Usage: /permissions set <query> or /permissions <default|auto|custom>');
  }

  const next = context.permissions.set(selected);
  return slashMessageResult(`Set permission mode to ${next}.`);
}

function isPermissionMode(value: string): value is AutonomyPermissionMode {
  return AUTONOMY_PERMISSION_MODES.includes(value as AutonomyPermissionMode);
}

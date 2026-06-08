import type { SlashCommandModule } from '../types.js';
import type { SlashCommandResult } from '../result-types.js';
import type { SlashCommandExecutionContext } from './context.js';
import { createAuthSlashCommandModule } from './auth/auth-commands.js';
import { createCompactionSlashCommandModule } from './compaction/compaction-commands.js';
import { createDriftSlashCommandModule } from './drift/drift-commands.js';
import { createHeartbeatSlashCommandModule } from './heartbeat/heartbeat-commands.js';
import { createHelpSlashCommandModule } from './help/help-commands.js';
import { createModelSlashCommandModule, createReasoningSlashCommandModule } from './model/model-commands.js';
import { createPermissionsSlashCommandModule } from './permissions/permission-commands.js';
import { createSessionSlashCommandModule } from './session/session-commands.js';

export function createCoreSlashCommandModules(): SlashCommandModule<
  SlashCommandResult,
  SlashCommandExecutionContext
>[] {
  return [
    createHelpSlashCommandModule(),
    createModelSlashCommandModule(),
    createReasoningSlashCommandModule(),
    createAuthSlashCommandModule(),
    createCompactionSlashCommandModule(),
    createDriftSlashCommandModule(),
    createPermissionsSlashCommandModule(),
    createSessionSlashCommandModule(),
    createHeartbeatSlashCommandModule(),
  ];
}

import type { SlashCommandModule } from '../types.js';
import type { CoreSlashCommandResult, SlashCommandExecutionContext } from './context.js';
import { createAuthSlashCommandModule } from './auth/auth-commands.js';
import { createCompactionSlashCommandModule } from './compaction/compaction-commands.js';
import { createDriftSlashCommandModule } from './drift/drift-commands.js';
import { createModelSlashCommandModule } from './model/model-commands.js';
import { createSessionSlashCommandModule } from './session/session-commands.js';

export function createCoreSlashCommandModules(): SlashCommandModule<
  CoreSlashCommandResult,
  SlashCommandExecutionContext
>[] {
  return [
    createModelSlashCommandModule(),
    createAuthSlashCommandModule(),
    createCompactionSlashCommandModule(),
    createDriftSlashCommandModule(),
    createSessionSlashCommandModule(),
  ];
}

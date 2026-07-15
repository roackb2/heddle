import type { ConversationEngineConfig } from '@/core/chat/engine/types.js';
import { SlashCommandRegistry } from '@/core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '@/core/commands/slash/modules/core-command-modules.js';
import type { SlashCommandResult } from '@/core/commands/slash/result-types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { controlPlaneSlashCommandExecutionContextService } from '@/server/services/control-plane/slash-command-execution-context-service.js';

type SlashCommandControllerArgs = Omit<ConversationEngineConfig, 'model'> & {
  model?: string;
  sessionStoragePath: string;
  workspaceId: string;
  sessionId: string;
  leaseOwner: ChatSessionLeaseOwner;
  compactActive: () => Promise<string> | string;
};

const registry = new SlashCommandRegistry(createCoreSlashCommandModules());

/**
 * Exposes core slash-command semantics through the frontend-agnostic control plane.
 */
export class ControlPlaneSlashCommandsController {
  catalog() {
    return {
      commands: registry.commands().map(({ id, syntax, description, aliases }) => ({
        id,
        syntax,
        description,
        ...(aliases ? { aliases } : {}),
      })),
      hints: registry.hints(),
    };
  }

  async execute(args: SlashCommandControllerArgs, command: string): Promise<SlashCommandResult> {
    const result = await registry.run(
      await controlPlaneSlashCommandExecutionContextService.create(args, registry.hints()),
      command.trim(),
    );
    return result ?? {
      handled: true,
      kind: 'message',
      message: `Unknown command: ${command.trim()}. Use the slash command hints to inspect available commands.`,
    };
  }
}

export const controlPlaneSlashCommandsController = new ControlPlaneSlashCommandsController();

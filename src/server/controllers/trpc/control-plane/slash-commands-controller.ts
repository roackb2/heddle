import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import type { ConversationEngineConfig } from '@/core/chat/engine/types.js';
import type { ChatSession } from '@/core/chat/types.js';
import { SlashCommandRegistry } from '@/core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '@/core/commands/slash/modules/core-command-modules.js';
import type { SlashCommandExecutionContext } from '@/core/commands/slash/modules/context.js';
import type { SlashCommandResult } from '@/core/commands/slash/result-types.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { FileHeartbeatTaskService } from '@/core/heartbeat/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import type { LlmProvider } from '@/core/llm/types.js';
import { controlPlaneChatSessionsController } from './chat-sessions-controller.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { SlashCommandHint } from '@/core/commands/slash/types.js';

type SlashCommandControllerArgs = Omit<ConversationEngineConfig, 'model'> & {
  model?: string;
  sessionStoragePath: string;
  workspaceId: string;
  sessionId: string;
  leaseOwner: ChatSessionLeaseOwner;
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
    const result = await registry.run(this.createExecutionContext(args), command.trim());
    return result ?? {
      handled: true,
      kind: 'message',
      message: `Unknown command: ${command.trim()}. Use the slash command hints to inspect available commands.`,
    };
  }

  private createExecutionContext(args: SlashCommandControllerArgs): SlashCommandExecutionContext {
    const engine = createConversationEngine({
      ...args,
      model: args.model ?? DEFAULT_OPENAI_MODEL,
    });
    const sessions = engine.sessions;
    const heartbeatTasks = new FileHeartbeatTaskService({ stateRoot: args.stateRoot });

    return {
      model: {
        active: () => sessions.require(args.sessionId).model ?? args.model ?? DEFAULT_OPENAI_MODEL,
        setActive: (model) => {
          sessions.updateSettings(args.sessionId, { model });
        },
        activeReasoningEffort: () => sessions.require(args.sessionId).reasoningEffort,
        setReasoningEffort: (reasoningEffort) => {
          sessions.updateSettings(args.sessionId, { reasoningEffort });
        },
        credentialSource: () => RuntimeCredentialService.resolveCredentialSourceForModel(
          sessions.require(args.sessionId).model ?? args.model ?? DEFAULT_OPENAI_MODEL,
          args,
        ),
      },
      auth: {
        status: () => this.formatAuthStatus(args.credentialStorePath),
        login: async (provider) => {
          throw new Error(`OAuth login for ${provider} is only available through the terminal auth command.`);
        },
        logout: (provider) => this.logoutProvider(provider, args.credentialStorePath),
      },
      compaction: {
        compactActive: async () => {
          await controlPlaneChatSessionsController.compactSession({
            ...args,
            force: true,
          });
          return 'Compacted earlier session history for the next run.';
        },
      },
      drift: {
        status: () => {
          const session = sessions.require(args.sessionId);
          return { enabled: session.driftEnabled ?? false };
        },
        setEnabled: (enabled) => {
          sessions.setDriftEnabled(args.sessionId, enabled);
        },
      },
      session: {
        all: () => sessions.listExisting(),
        recent: () => this.recentSessions(sessions.listExisting()),
        recentListMessage: () => this.recentSessionMessages(sessions.listExisting()),
        create: (name) => sessions.create({
          name,
          model: sessions.require(args.sessionId).model ?? args.model,
          workspaceId: args.workspaceId,
        }),
        switch: (id) => {
          sessions.require(id);
        },
        rename: (name) => {
          sessions.rename(args.sessionId, name);
        },
        remove: (id) => {
          sessions.delete(id);
        },
        clear: () => {
          const model = sessions.require(args.sessionId).model ?? args.model ?? DEFAULT_OPENAI_MODEL;
          sessions.resetConversation(args.sessionId, {
            apiKeyPresent: RuntimeCredentialService.hasCredentialForModel(model, args),
          });
        },
        summarize: ChatSessionRecords.summarize,
      },
      heartbeat: {
        listTasks: async () => await heartbeatTasks.listTasks(),
        listRunRecords: async (options) => await heartbeatTasks.listRunRecords(options),
        loadRunRecord: async (id) => await heartbeatTasks.loadRunRecord(id),
      },
      help: {
        message: () => this.formatHelpMessage(registry.hints()),
      },
    };
  }

  private recentSessions(sessions: ChatSession[]): ChatSession[] {
    return [...sessions].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')).slice(0, 10);
  }

  private recentSessionMessages(sessions: ChatSession[]): string[] {
    return this.recentSessions(sessions).map((session, index) => (
      `${index + 1}. ${session.id} (${session.name}) - ${ChatSessionRecords.summarize(session)}`
    ));
  }

  private formatAuthStatus(storePath = ProviderCredentialRepository.resolveStorePath()): string {
    const summaries = new ProviderCredentialRepository({ storePath }).listSummaries();
    const lines = [`Auth store: ${storePath}`];
    if (summaries.length === 0) {
      return [...lines, 'Stored credentials: none'].join('\n');
    }

    return [
      ...lines,
      'Stored credentials:',
      ...summaries.map((summary) => {
        const details = [
          `type=${summary.type}`,
          summary.label ? `label=${summary.label}` : undefined,
          summary.accountId ? `account=${summary.accountId}` : undefined,
          summary.expiresAt ? `expires=${new Date(summary.expiresAt).toISOString()}` : undefined,
          summary.expired === true ? 'expired=true' : undefined,
          `updated=${summary.updatedAt}`,
        ].filter(Boolean);
        return `- ${summary.provider}: ${details.join(' ')}`;
      }),
    ].join('\n');
  }

  private logoutProvider(provider: LlmProvider, storePath = ProviderCredentialRepository.resolveStorePath()): string {
    const removed = new ProviderCredentialRepository({ storePath }).remove(provider);
    return removed ? `Removed stored ${provider} credential.` : `No stored ${provider} credential found.`;
  }

  private formatHelpMessage(hints: SlashCommandHint[]): string {
    return [
      'Slash commands',
      '',
      ...hints.flatMap((hint) => [hint.command, capitalizeFirst(hint.description), '']),
    ].join('\n').trimEnd();
  }
}

export const controlPlaneSlashCommandsController = new ControlPlaneSlashCommandsController();

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}.` : value;
}

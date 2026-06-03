import { FileHeartbeatTaskService } from '@/core/heartbeat/index.js';
import { ProviderCredentialCommandService } from '@/core/auth/index.js';
import { ChatSessionRecords } from '../../../core/chat/engine/sessions/records/index.js';
import type { SlashCommandExecutionContext } from '../../../core/commands/slash/modules/context.js';
import type { LocalCommandArgs } from '../state/local-commands.js';

export function createTuiSlashCommandContext(args: LocalCommandArgs): SlashCommandExecutionContext {
  const heartbeatTasks = new FileHeartbeatTaskService({ stateRoot: args.stateRoot });

  return {
    model: {
      active: () => args.activeModel,
      setActive: args.setActiveModel,
      activeReasoningEffort: () => args.activeReasoningEffort,
      setReasoningEffort: args.setActiveReasoningEffort,
      credentialSource: () => args.providerCredentialSource,
    },
    auth: {
      // v1 compatibility only: remove this direct auth service adapter when
      // the legacy TUI slash-command path is retired.
      status: () => ProviderCredentialCommandService.formatStatusMessage(args.credentialStorePath),
      login: (provider) =>
        ProviderCredentialCommandService.loginProviderWithOAuth(provider, {
          storePath: args.credentialStorePath,
          openAiLogin: args.openAiLogin,
        }),
      logout: (provider) => ProviderCredentialCommandService.logoutProvider(provider, args.credentialStorePath),
    },
    compaction: {
      compactActive: args.compactConversation,
    },
    drift: {
      status: () => ({ enabled: args.driftEnabled, error: args.driftError }),
      setEnabled: args.setDriftEnabled,
    },
    session: {
      all: () => args.sessions,
      recent: () => args.recentSessions,
      recentListMessage: () => args.listRecentSessionsMessage,
      create: args.createSession,
      switch: args.switchSession,
      rename: args.renameSession,
      remove: args.removeSession,
      clear: args.clearConversation,
      summarize: ChatSessionRecords.summarize,
    },
    heartbeat: {
      listTasks: async () => await heartbeatTasks.listTasks(),
      listRunRecords: async (options) => await heartbeatTasks.listRunRecords(options),
      loadRunRecord: async (id) => await heartbeatTasks.loadRunRecord(id),
    },
    help: {
      message: () => 'Use /help for available local commands.',
    },
  };
}

import { formatAuthStatusMessage, loginProviderWithOAuth, logoutProvider } from '../../auth.js';
import { summarizeSession } from '../state/storage.js';
import type { SlashCommandExecutionContext } from '../../../core/commands/slash/modules/context.js';
import type { LocalCommandArgs } from '../state/local-commands.js';

export function createTuiSlashCommandContext(args: LocalCommandArgs): SlashCommandExecutionContext {
  return {
    model: {
      active: () => args.activeModel,
      setActive: args.setActiveModel,
      credentialSource: () => args.providerCredentialSource,
    },
    auth: {
      status: () => formatAuthStatusMessage(args.credentialStorePath),
      login: (provider) =>
        loginProviderWithOAuth(provider, {
          storePath: args.credentialStorePath,
          openAiLogin: args.openAiLogin,
        }),
      logout: (provider) => logoutProvider(provider, args.credentialStorePath),
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
      summarize: summarizeSession,
    },
  };
}

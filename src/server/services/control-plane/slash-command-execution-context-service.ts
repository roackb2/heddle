import { ProviderCredentialCommandService } from '@/core/auth/index.js';
import { AutonomyPermissionModeService } from '@/core/approvals/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import type { ConversationEngineConfig } from '@/core/chat/engine/types.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { SlashCommandExecutionContext } from '@/core/commands/slash/modules/context.js';
import type { SlashCommandHint } from '@/core/commands/slash/types.js';
import { FileHeartbeatTaskService } from '@/core/heartbeat/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { controlPlaneSessionRuntimeContextService } from './session-runtime-context-service.js';

export type ControlPlaneSlashCommandExecutionContextArgs = Omit<ConversationEngineConfig, 'model'> & {
  model?: string;
  sessionStoragePath: string;
  workspaceId: string;
  sessionId: string;
  leaseOwner: ChatSessionLeaseOwner;
  compactActive: () => Promise<string> | string;
};

/**
 * Composes core slash-command ports from resolved control-plane runtime context.
 */
export class ControlPlaneSlashCommandExecutionContextService {
  create(
    args: ControlPlaneSlashCommandExecutionContextArgs,
    hints: SlashCommandHint[],
  ): SlashCommandExecutionContext {
    const resolved = controlPlaneSessionRuntimeContextService.resolve(args);
    const { runtimeContext, sessions } = resolved;
    const heartbeatTasks = new FileHeartbeatTaskService({ stateRoot: args.stateRoot });

    return {
      model: {
        active: () => runtimeContext.model,
        setActive: (model) => {
          sessions.updateSettings(args.sessionId, { model });
        },
        activeReasoningEffort: () => runtimeContext.reasoningEffort,
        setReasoningEffort: (reasoningEffort) => {
          sessions.updateSettings(args.sessionId, { reasoningEffort });
        },
        credentialSource: () => runtimeContext.credentialSource,
      },
      auth: {
        status: () => ProviderCredentialCommandService.formatStatusMessage(args.credentialStorePath),
        login: (provider) => ProviderCredentialCommandService.loginProviderWithOAuth(provider, {
          storePath: args.credentialStorePath,
        }),
        logout: (provider) => ProviderCredentialCommandService.logoutProvider(provider, args.credentialStorePath),
      },
      compaction: {
        compactActive: args.compactActive,
      },
      drift: {
        status: () => ({ enabled: runtimeContext.driftEnabled }),
        setEnabled: (enabled) => {
          sessions.setDriftEnabled(args.sessionId, enabled);
        },
      },
      permissions: {
        current: () => AutonomyPermissionModeService.resolveMode({
          config: ProjectConfigService.read(args.workspaceRoot),
          workspaceRoot: args.workspaceRoot,
        }),
        set: (mode) => {
          const config = ProjectConfigService.update(args.workspaceRoot, (current) => (
            AutonomyPermissionModeService.applyMode({
              config: current,
              mode,
              workspaceRoot: args.workspaceRoot,
            })
          ));
          return AutonomyPermissionModeService.resolveMode({
            config,
            workspaceRoot: args.workspaceRoot,
          });
        },
      },
      session: {
        all: () => sessions.listExisting(),
        recent: () => this.recentSessions(sessions.listExisting()),
        recentListMessage: () => this.recentSessionMessages(sessions.listExisting()),
        create: (name) => sessions.create({
          name,
          model: runtimeContext.model,
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
          sessions.resetConversation(args.sessionId);
        },
        summarize: ChatSessionRecords.summarize,
      },
      heartbeat: {
        listTasks: async () => await heartbeatTasks.listTasks(),
        listRunRecords: async (options) => await heartbeatTasks.listRunRecords(options),
        loadRunRecord: async (id) => await heartbeatTasks.loadRunRecord(id),
      },
      help: {
        message: () => this.formatHelpMessage(hints),
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

  private formatHelpMessage(hints: SlashCommandHint[]): string {
    return [
      'Slash commands',
      '',
      ...hints.flatMap((hint) => [hint.command, capitalizeFirst(hint.description), '']),
    ].join('\n').trimEnd();
  }
}

export const controlPlaneSlashCommandExecutionContextService = new ControlPlaneSlashCommandExecutionContextService();

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}.` : value;
}

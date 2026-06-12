import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import type { ConversationEngine, ConversationEngineConfig } from '@/core/chat/engine/types.js';
import { resolveEffectiveReasoningEffort } from '@/core/chat/engine/sessions/preferences/service.js';
import type { ChatSession } from '@/core/chat/types.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { CustomAgentService } from '@/core/custom-agents/index.js';
import { AutonomyPermissionModeService } from '@/core/approvals/index.js';
import { ModelCatalogService, ModelPolicyService } from '@/core/llm/models/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import type { ChatSessionView, ControlPlaneSessionRuntimeContext } from '@/server/control-plane-types.js';
import { ControlPlaneSessionDriftService } from './session-drift-service.js';

export type ControlPlaneSessionRuntimeContextArgs = Omit<ConversationEngineConfig, 'model'> & {
  model?: string;
  sessionStoragePath: string;
  workspaceId: string;
  sessionId: string;
};

export type ControlPlaneSessionRuntimeContextOptions = {
  driftLevel?: ChatSessionView['driftLevel'];
  running?: boolean;
};

export type ControlPlaneResolvedSessionRuntimeContext = {
  args: ControlPlaneSessionRuntimeContextArgs;
  engine: ConversationEngine;
  sessions: ConversationEngine['sessions'];
  session: ChatSession;
  runtimeContext: ControlPlaneSessionRuntimeContext;
};

/**
 * Owns selected-session runtime facts for control-plane consumers.
 *
 * Keep facts here when they describe the current executable session context
 * rather than persisted transcript data: selected model, resolved credentials,
 * model capabilities, context-window estimates, drift/run state, and empty
 * session welcome facts. Interface layers decide how to render those facts.
 */
export class ControlPlaneSessionRuntimeContextService {
  read(
    args: ControlPlaneSessionRuntimeContextArgs,
    options: ControlPlaneSessionRuntimeContextOptions = {},
  ): ControlPlaneSessionRuntimeContext {
    return this.resolve(args, options).runtimeContext;
  }

  resolve(
    args: ControlPlaneSessionRuntimeContextArgs,
    options: ControlPlaneSessionRuntimeContextOptions = {},
  ): ControlPlaneResolvedSessionRuntimeContext {
    const engine = createConversationEngine({
      ...args,
      model: args.model ?? DEFAULT_OPENAI_MODEL,
    });
    const sessions = engine.sessions;
    const session = sessions.require(args.sessionId);
    const model = session.model ?? args.model ?? DEFAULT_OPENAI_MODEL;
    const estimatedInputTokens = session.context?.request?.usage?.inputTokens ?? session.context?.request?.estimatedTokens;
    const providerRuntime = LlmProviderRuntimeService.resolve({
      ...args,
      model,
      reasoningEffort: session.reasoningEffort,
    });
    const credentialSource = providerRuntime.credentialSource;
    const projectConfig = ProjectConfigService.read(args.workspaceRoot);
    const permissionMode = AutonomyPermissionModeService.resolveMode({
      config: projectConfig,
      workspaceRoot: args.workspaceRoot,
    });
    const permissionModeOptions = AutonomyPermissionModeService.buildOptions({
      config: projectConfig,
      workspaceRoot: args.workspaceRoot,
    });
    const agentOptions = new CustomAgentService({
      workspaceRoot: args.workspaceRoot,
    }).listOptions();

    return {
      args,
      engine,
      sessions,
      session,
      runtimeContext: {
        workspaceId: args.workspaceId,
        sessionId: session.id,
        sessionName: session.name,
        model,
        reasoningEffort: session.reasoningEffort,
        effectiveReasoningEffort: resolveEffectiveReasoningEffort({
          model,
          reasoningEffort: session.reasoningEffort,
        }),
        reasoningSupported: ModelPolicyService.supportsReasoningEffort(model),
        reasoningOptions: ModelPolicyService.buildReasoningEffortOptions(model),
        credentialSource,
        contextWindow: ModelCatalogService.estimateBuiltInContextWindow(model),
        estimatedInputTokens,
        driftEnabled: session.driftEnabled ?? false,
        driftLevel: options.driftLevel ?? ControlPlaneSessionDriftService.readLatestDriftLevel(session.turns),
        compactionStatus: session.context?.compaction?.status,
        running: options.running ?? false,
        permissionMode,
        permissionModeOptions,
        agentOptions,
        welcomeGuide: {
          mode: 'conversation',
          hasProviderCredential: credentialSource.type !== 'missing',
          carriesTranscriptAcrossTurns: true,
        },
      },
    };
  }

}

export const controlPlaneSessionRuntimeContextService = new ControlPlaneSessionRuntimeContextService();

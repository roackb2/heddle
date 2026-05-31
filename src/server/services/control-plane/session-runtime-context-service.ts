import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import type { ConversationEngine, ConversationEngineConfig } from '@/core/chat/engine/types.js';
import { resolveEffectiveReasoningEffort } from '@/core/chat/engine/sessions/preferences/service.js';
import type { ChatSession } from '@/core/chat/types.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { ModelCatalogService, ModelPolicyService } from '@/core/llm/models/index.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
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
 * Resolves selected-session runtime facts once for API views and command ports.
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
        reasoningOptions: this.buildReasoningOptions(model),
        credentialSource: RuntimeCredentialService.resolveCredentialSourceForModel(model, args),
        contextWindow: ModelCatalogService.estimateBuiltInContextWindow(model),
        estimatedInputTokens,
        driftEnabled: session.driftEnabled ?? false,
        driftLevel: options.driftLevel ?? ControlPlaneSessionDriftService.readLatestDriftLevel(session.turns),
        compactionStatus: session.context?.compaction?.status,
        running: options.running ?? false,
      },
    };
  }

  private buildReasoningOptions(model: string): ControlPlaneSessionRuntimeContext['reasoningOptions'] {
    const requestSupported = ModelPolicyService.supportsOpenAiRequestReasoningEffort(model);
    const reasoningSupported = ModelPolicyService.supportsReasoningEffort(model);
    const defaultEffort = ModelPolicyService.resolveDefaultReasoningEffort(model);
    const disabledReason =
      reasoningSupported ?
        'Not supported by request path'
      : 'Not supported';

    return [
      {
        id: 'default',
        label: 'default',
        description: defaultEffort ? `Use ${model} default (${defaultEffort})` : `Do not send reasoning effort for ${model}`,
        disabled: false,
      },
      ...(['low', 'medium', 'high'] as const).map((effort) => ({
        id: effort,
        label: effort,
        description: `Set explicit ${effort} effort`,
        disabled: !requestSupported,
        disabledReason: requestSupported ? undefined : disabledReason,
      })),
      {
        id: 'ultrahigh' as ReasoningEffort,
        label: 'ultrahigh',
        description: 'Reserved; not accepted by current OpenAI requests',
        disabled: true,
        disabledReason: 'Reserved',
      },
    ];
  }
}

export const controlPlaneSessionRuntimeContextService = new ControlPlaneSessionRuntimeContextService();

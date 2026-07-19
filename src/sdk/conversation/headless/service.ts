import omit from 'lodash/omit.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import type {
  ConversationEngine,
  ConversationEngineConfig,
  ConversationEngineHost,
  EnsureConversationSessionResult,
} from '@/core/chat/engine/types.js';
import { ConversationSdkRuntimeService } from '../runtime/index.js';
import type {
  ConversationAgentOptions,
  ConversationAgentRuntimeContext,
  ConversationAgentSendInput,
  ConversationAgentSessionOptions,
  ConversationAgentTurnResult,
} from './types.js';

const DEFAULT_SESSION_ID = 'session-1';
const DEFAULT_SESSION_NAME = 'Heddle SDK conversation';

/**
 * Owns the smallest headless conversation lifecycle: runtime defaults,
 * credential preflight, stable session ensure, structured activities, and one
 * turn result. Full lifecycle control remains available through `engine`.
 */
export class ConversationAgentService {
  readonly engine: ConversationEngine;
  readonly runtime: ConversationAgentRuntimeContext;

  private readonly defaultHost?: ConversationEngineHost;
  private readonly session: Required<Pick<ConversationAgentSessionOptions, 'id'>>
    & Omit<ConversationAgentSessionOptions, 'id'>;

  constructor(options: ConversationAgentOptions = {}) {
    const defaults = ConversationSdkRuntimeService.resolveDefaults(options);
    const credential = ConversationSdkRuntimeService.preflightCredentials({
      apiKey: options.apiKey,
      credentialStorePath: options.credentialStorePath,
      defaults,
      preferApiKey: options.preferApiKey,
      preflight: options.credentialPreflight,
    });
    const engineConfig = {
      ...omit(options, [
        'credentialPreflight',
        'env',
        'host',
        'maxSteps',
        'memoryMaintenanceMode',
        'model',
        'reasoningEffort',
        'session',
        'stateRoot',
        'workspaceRoot',
      ]),
      ...omit(defaults, ['maxSteps']),
    } satisfies ConversationEngineConfig;

    this.engine = createConversationEngine(engineConfig);
    this.runtime = {
      ...defaults,
      ...(credential ? { credential } : {}),
    };
    this.defaultHost = options.host;
    this.session = {
      ...options.session,
      id: options.session?.id ?? DEFAULT_SESSION_ID,
      name: options.session?.name ?? DEFAULT_SESSION_NAME,
    };
  }

  async ensureSession(): Promise<EnsureConversationSessionResult> {
    return await this.engine.sessions.ensure(this.session);
  }

  async send(input: ConversationAgentSendInput): Promise<ConversationAgentTurnResult> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Conversation agent prompt cannot be empty.');
    }

    const session = await this.ensureSession();
    const activities: ConversationAgentTurnResult['activities'] = [];
    const result = await this.engine.turns.submit({
      ...omit(input, ['prompt']),
      sessionId: session.session.id,
      prompt,
      maxSteps: input.maxSteps ?? this.runtime.maxSteps,
      memoryMaintenanceMode: input.memoryMaintenanceMode ?? this.runtime.memoryMaintenanceMode,
      host: ConversationAgentService.captureActivities(
        input.host ?? this.defaultHost,
        activities,
      ),
    });

    return {
      ...result,
      activities,
      sessionCreated: session.created,
    };
  }

  private static captureActivities(
    host: ConversationEngineHost | undefined,
    activities: ConversationAgentTurnResult['activities'],
  ): ConversationEngineHost {
    return {
      ...host,
      events: {
        ...host?.events,
        onActivity(activity) {
          activities.push(activity);
          host?.events?.onActivity?.(activity);
        },
      },
    };
  }
}

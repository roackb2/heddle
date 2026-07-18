import { join } from 'node:path';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import type {
  ConversationAgentCredentialContext,
  ConversationAgentCredentialPreflightOptions,
  ConversationAgentRuntimeDefaults,
  ConversationAgentRuntimeDefaultsInput,
} from './types.js';

const DEFAULT_MEMORY_MAINTENANCE_MODE = 'none';
const SUPPORTED_REASONING_EFFORTS = new Set<ReasoningEffort>([
  'low',
  'medium',
  'high',
  'ultrahigh',
]);

/** Owns the environment-derived defaults and credential preflight shared by headless and CLI SDK starters. */
export class ConversationAgentRuntimeService {
  static resolveDefaults(
    options: ConversationAgentRuntimeDefaultsInput = {},
  ): ConversationAgentRuntimeDefaults {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();

    return {
      ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
      memoryMaintenanceMode: options.memoryMaintenanceMode ?? DEFAULT_MEMORY_MAINTENANCE_MODE,
      model: ConversationAgentRuntimeService.resolveModel(options),
      reasoningEffort: ConversationAgentRuntimeService.resolveReasoningEffort(
        options.reasoningEffort,
      ),
      stateRoot: options.stateRoot ?? join(workspaceRoot, '.heddle'),
      workspaceRoot,
    };
  }

  static preflightCredentials(input: {
    apiKey?: string;
    credentialStorePath?: string;
    defaults: ConversationAgentRuntimeDefaults;
    preferApiKey?: boolean;
    preflight?: boolean | ConversationAgentCredentialPreflightOptions;
  }): ConversationAgentCredentialContext | undefined {
    const preflight = ConversationAgentRuntimeService.resolveCredentialPreflight(input.preflight);
    if (!preflight.enabled) {
      return undefined;
    }

    const resolution = LlmProviderRuntimeService.resolve({
      apiKey: input.apiKey,
      credentialStorePath: input.credentialStorePath,
      model: input.defaults.model,
      preferApiKey: input.preferApiKey,
      reasoningEffort: input.defaults.reasoningEffort,
    });
    const context = {
      model: resolution.model,
      preferApiKey: input.preferApiKey,
      provider: resolution.provider,
      source: resolution.credentialSource,
    } satisfies ConversationAgentCredentialContext;

    if (resolution.credentialSource.type === 'missing') {
      throw new Error([
        RuntimeCredentialService.formatMissingCredentialMessage(resolution.model),
        ConversationAgentRuntimeService.resolveMissingCredentialHint({
          context,
          missingCredentialHint: preflight.missingCredentialHint,
        }),
      ].filter(Boolean).join(' '));
    }

    return context;
  }

  private static resolveCredentialPreflight(
    input: boolean | ConversationAgentCredentialPreflightOptions | undefined,
  ): Required<Pick<ConversationAgentCredentialPreflightOptions, 'enabled'>>
    & Pick<ConversationAgentCredentialPreflightOptions, 'missingCredentialHint'> {
    if (input === false) {
      return { enabled: false };
    }

    if (input === true || input === undefined) {
      return { enabled: true };
    }

    return {
      enabled: input.enabled ?? true,
      missingCredentialHint: input.missingCredentialHint,
    };
  }

  private static resolveMissingCredentialHint(input: {
    context: ConversationAgentCredentialContext;
    missingCredentialHint: ConversationAgentCredentialPreflightOptions['missingCredentialHint'];
  }): string | undefined {
    const hint = typeof input.missingCredentialHint === 'function'
      ? input.missingCredentialHint(input.context)
      : input.missingCredentialHint;

    return hint?.trim() || undefined;
  }

  private static resolveModel(options: ConversationAgentRuntimeDefaultsInput): string {
    const env = options.env ?? process.env;
    return [
      options.model,
      env.HEDDLE_MODEL,
      env.HEDDLE_EXAMPLE_MODEL,
      env.OPENAI_MODEL,
      env.ANTHROPIC_MODEL,
      DEFAULT_OPENAI_MODEL,
    ].map((candidate) => candidate?.trim())
      .find((candidate): candidate is string => Boolean(candidate)) ?? DEFAULT_OPENAI_MODEL;
  }

  private static resolveReasoningEffort(
    input: ConversationAgentRuntimeDefaultsInput['reasoningEffort'],
  ): ReasoningEffort | undefined {
    const value = input?.trim();
    if (!value) {
      return undefined;
    }

    if (SUPPORTED_REASONING_EFFORTS.has(value as ReasoningEffort)) {
      return value as ReasoningEffort;
    }

    throw new Error(`Unsupported reasoning effort: ${value}. Use one of low, medium, high, ultrahigh.`);
  }
}

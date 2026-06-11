import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { LlmProvider, ReasoningEffort } from '@/core/llm/types.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import { ModelCatalogService, OPENAI_ACCOUNT_SIGN_IN_MODELS } from './model-catalog.js';

export type SystemModelPurpose = 'chat-compaction' | 'session-title';
export type ModelCredentialMode = 'api-key' | 'oauth' | 'missing';

export type CredentialAwareModelOption = {
  id: string;
  label?: string;
  disabled: boolean;
  disabledReason?: string;
};

export type ReasoningEffortOption = {
  id: 'default' | ReasoningEffort;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
};

export const OPENAI_API_KEY_COMPACTION_MODEL = 'gpt-5.1-codex-mini';
export const OPENAI_OAUTH_SYSTEM_MODEL = 'gpt-5.4';
export const ANTHROPIC_COMPACTION_MODEL = 'claude-haiku-4-5';
export const OPENAI_OAUTH_MODE_DESCRIPTION = 'OAuth mode supports a smaller OpenAI allowlist.';

const OPENAI_OAUTH_DISABLED_REASON = 'Not supported';
const OPENAI_OAUTH_IMAGE_MODEL_PREFERENCES = ['gpt-5.4', 'gpt-5.4-mini'];
const REASONING_EFFORT_CAPABLE_OPENAI_MODELS = [
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.5',
  'gpt-5.5-pro',
] as const;
const OPENAI_REQUEST_REASONING_EFFORT_COMPATIBLE_MODELS = [
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.5-pro',
] as const;
const OPENAI_REQUEST_REASONING_EFFORTS_BY_MODEL: Record<string, ReasoningEffort[]> = {
  'gpt-5.4': ['low', 'medium', 'high'],
  'gpt-5.4-pro': ['low', 'medium', 'high'],
  'gpt-5.4-mini': ['low', 'medium', 'high'],
  'gpt-5.5': ['low', 'medium', 'high', 'ultrahigh'],
  'gpt-5.5-pro': ['low', 'medium', 'high', 'ultrahigh'],
};
const DEFAULT_OPENAI_REASONING_EFFORT: Record<string, ReasoningEffort> = {
  'gpt-5.4': 'medium',
  'gpt-5.4-pro': 'medium',
  'gpt-5.4-mini': 'medium',
  'gpt-5.4-nano': 'low',
  'gpt-5.5': 'medium',
  'gpt-5.5-pro': 'medium',
};

/**
 * Provider-neutral model policy facade. It centralizes model capability,
 * credential compatibility, and system-model selection used by hosts.
 */
export class ModelPolicyService {
  static credentialModeFromSource(source: ProviderCredentialSource | undefined): ModelCredentialMode {
    if (source?.type === 'oauth') {
      return 'oauth';
    }

    if (source?.type === 'missing') {
      return 'missing';
    }

    return 'api-key';
  }

  static resolveSystemSelectedModel(args: {
    purpose: SystemModelPurpose;
    provider: LlmProvider;
    activeModel?: string;
    credentialMode?: ModelCredentialMode;
  }): string {
    if (args.provider === 'anthropic') {
      return args.purpose === 'chat-compaction' ? ANTHROPIC_COMPACTION_MODEL : DEFAULT_ANTHROPIC_MODEL;
    }

    if (args.provider === 'openai') {
      if (args.credentialMode === 'oauth') {
        return args.activeModel && ModelCatalogService.isOpenAiAccountSignInModel(args.activeModel) ? args.activeModel : OPENAI_OAUTH_SYSTEM_MODEL;
      }

      return args.purpose === 'chat-compaction' ? OPENAI_API_KEY_COMPACTION_MODEL : DEFAULT_OPENAI_MODEL;
    }

    const activeModel = args.activeModel?.trim();
    if (activeModel) {
      return activeModel;
    }

    throw new Error(`No ${args.purpose} system model is configured for ${args.provider}.`);
  }

  static validateCredentialCompatibility(args: {
    model: string;
    provider: LlmProvider;
    credentialMode?: ModelCredentialMode;
    usageLabel?: string;
  }): { ok: true } | { ok: false; error: string } {
    if (args.provider === 'openai' && args.credentialMode === 'oauth' && !ModelCatalogService.isOpenAiAccountSignInModel(args.model)) {
      return {
        ok: false,
        error: `OpenAI account sign-in is not enabled for model ${args.model}. Use one of ${ModelPolicyService.formatOpenAiAccountSignInModels()}, or set OPENAI_API_KEY to use Platform API-key mode${args.usageLabel ? ` for ${args.usageLabel}` : ''}.`,
      };
    }

    return { ok: true };
  }

  static assertCredentialCompatibility(args: {
    model: string;
    provider: LlmProvider;
    credentialMode?: ModelCredentialMode;
    usageLabel?: string;
  }) {
    const result = ModelPolicyService.validateCredentialCompatibility(args);
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  static resolveOpenAiOAuthImageCandidateModels(activeModel: string): string[] {
    return ModelPolicyService.uniqueModels([activeModel, ...OPENAI_OAUTH_IMAGE_MODEL_PREFERENCES, ...OPENAI_ACCOUNT_SIGN_IN_MODELS]);
  }

  static buildCredentialAwareModelOption(args: {
    model: string;
    provider: LlmProvider;
    credentialMode?: ModelCredentialMode;
    label?: string;
  }): CredentialAwareModelOption {
    const compatibility = ModelPolicyService.validateCredentialCompatibility({
      model: args.model,
      provider: args.provider,
      credentialMode: args.credentialMode,
    });

    return {
      id: args.model,
      label: args.label,
      disabled: !compatibility.ok,
      disabledReason: compatibility.ok ? undefined : ModelPolicyService.summarizeCredentialCompatibilityError(args),
    };
  }

  static summarizeCredentialCompatibilityError(args: {
    model: string;
    provider: LlmProvider;
    credentialMode?: ModelCredentialMode;
  }): string | undefined {
    if (args.provider === 'openai' && args.credentialMode === 'oauth' && !ModelCatalogService.isOpenAiAccountSignInModel(args.model)) {
      return OPENAI_OAUTH_DISABLED_REASON;
    }

    return undefined;
  }

  static resolveCompatibleActiveModel(args: {
    activeModel: string;
    provider: LlmProvider;
    credentialMode?: ModelCredentialMode;
  }): { model: string; warning?: string } {
    const compatibility = ModelPolicyService.validateCredentialCompatibility({
      model: args.activeModel,
      provider: args.provider,
      credentialMode: args.credentialMode,
    });
    if (compatibility.ok) {
      return { model: args.activeModel };
    }

    const fallback = ModelPolicyService.resolveSystemSelectedModel({
      purpose: 'session-title',
      provider: args.provider,
      activeModel: args.activeModel,
      credentialMode: args.credentialMode,
    });

    if (fallback === args.activeModel) {
      return {
        model: args.activeModel,
        warning: `Model ${args.activeModel} is not supported with OpenAI account sign-in. Pick a supported OAuth model with /model set or use API-key mode.`,
      };
    }

    return {
      model: fallback,
      warning: `Model ${args.activeModel} is not supported with OpenAI account sign-in. Switched to ${fallback} for this session.`,
    };
  }

  static supportsReasoningEffort(model: string): boolean {
    return REASONING_EFFORT_CAPABLE_OPENAI_MODELS.includes(model as (typeof REASONING_EFFORT_CAPABLE_OPENAI_MODELS)[number]);
  }

  static supportsOpenAiRequestReasoningEffort(model: string): boolean {
    return ModelPolicyService.supportedOpenAiRequestReasoningEfforts(model).length > 0;
  }

  static supportsOpenAiRequestReasoningEffortLevel(model: string, effort: ReasoningEffort): boolean {
    return ModelPolicyService.supportedOpenAiRequestReasoningEfforts(model).includes(effort);
  }

  static supportedOpenAiRequestReasoningEfforts(model: string): ReasoningEffort[] {
    return OPENAI_REQUEST_REASONING_EFFORTS_BY_MODEL[model] ?? (
      OPENAI_REQUEST_REASONING_EFFORT_COMPATIBLE_MODELS.includes(model as (typeof OPENAI_REQUEST_REASONING_EFFORT_COMPATIBLE_MODELS)[number]) ?
        ['low', 'medium', 'high']
      : []
    );
  }

  static buildReasoningEffortOptions(model: string): ReasoningEffortOption[] {
    const requestSupportedEfforts = new Set(ModelPolicyService.supportedOpenAiRequestReasoningEfforts(model));
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
      ...(['low', 'medium', 'high', 'ultrahigh'] as const).map((effort) => ({
        id: effort,
        label: effort,
        description: `Set explicit ${effort} effort`,
        disabled: !requestSupportedEfforts.has(effort),
        disabledReason: requestSupportedEfforts.has(effort) ? undefined : disabledReason,
      })),
    ];
  }

  static resolveDefaultReasoningEffort(model: string): ReasoningEffort | undefined {
    return DEFAULT_OPENAI_REASONING_EFFORT[model];
  }

  static formatOpenAiAccountSignInModels(): string {
    return OPENAI_ACCOUNT_SIGN_IN_MODELS.join(', ');
  }

  private static uniqueModels(models: string[]): string[] {
    return [...new Set(models)];
  }
}

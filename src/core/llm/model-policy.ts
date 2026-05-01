import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../config.js';
import type { ProviderCredentialSource } from '../runtime/api-keys.js';
import { isOpenAiAccountSignInModel, OPENAI_ACCOUNT_SIGN_IN_MODELS } from './openai-models.js';
import type { LlmProvider } from './types.js';

export type SystemModelPurpose = 'chat-compaction' | 'session-title';
export type ModelCredentialMode = 'api-key' | 'oauth' | 'missing';

export type CredentialAwareModelOption = {
  id: string;
  label?: string;
  disabled: boolean;
  disabledReason?: string;
};

export const OPENAI_API_KEY_COMPACTION_MODEL = 'gpt-5.1-codex-mini';
export const OPENAI_OAUTH_SYSTEM_MODEL = 'gpt-5.4';
export const ANTHROPIC_COMPACTION_MODEL = 'claude-haiku-4-5';
const OPENAI_OAUTH_DISABLED_REASON = 'Not supported';
export const OPENAI_OAUTH_MODE_DESCRIPTION = 'OAuth mode supports a smaller OpenAI allowlist.';

const OPENAI_OAUTH_IMAGE_MODEL_PREFERENCES = ['gpt-5.4', 'gpt-5.4-mini'];

export function credentialModeFromSource(source: ProviderCredentialSource | undefined): ModelCredentialMode {
  if (source?.type === 'oauth') {
    return 'oauth';
  }

  if (source?.type === 'missing') {
    return 'missing';
  }

  return 'api-key';
}

export function resolveSystemSelectedModel(args: {
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
      return args.activeModel && isOpenAiAccountSignInModel(args.activeModel) ? args.activeModel : OPENAI_OAUTH_SYSTEM_MODEL;
    }

    return args.purpose === 'chat-compaction' ? OPENAI_API_KEY_COMPACTION_MODEL : DEFAULT_OPENAI_MODEL;
  }

  return DEFAULT_OPENAI_MODEL;
}

export function validateModelCredentialCompatibility(args: {
  model: string;
  provider: LlmProvider;
  credentialMode?: ModelCredentialMode;
  usageLabel?: string;
}): { ok: true } | { ok: false; error: string } {
  if (args.provider === 'openai' && args.credentialMode === 'oauth' && !isOpenAiAccountSignInModel(args.model)) {
    return {
      ok: false,
      error: `OpenAI account sign-in is not enabled for model ${args.model}. Use one of ${formatOpenAiAccountSignInModels()}, or set OPENAI_API_KEY to use Platform API-key mode${args.usageLabel ? ` for ${args.usageLabel}` : ''}.`,
    };
  }

  return { ok: true };
}

export function assertModelCredentialCompatibility(args: {
  model: string;
  provider: LlmProvider;
  credentialMode?: ModelCredentialMode;
  usageLabel?: string;
}) {
  const result = validateModelCredentialCompatibility(args);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export function resolveOpenAiOAuthImageCandidateModels(activeModel: string): string[] {
  return uniqueModels([activeModel, ...OPENAI_OAUTH_IMAGE_MODEL_PREFERENCES, ...OPENAI_ACCOUNT_SIGN_IN_MODELS]);
}

export function buildCredentialAwareModelOption(args: {
  model: string;
  provider: LlmProvider;
  credentialMode?: ModelCredentialMode;
  label?: string;
}): CredentialAwareModelOption {
  const compatibility = validateModelCredentialCompatibility({
    model: args.model,
    provider: args.provider,
    credentialMode: args.credentialMode,
  });

  return {
    id: args.model,
    label: args.label,
    disabled: !compatibility.ok,
    disabledReason: compatibility.ok ? undefined : summarizeCredentialCompatibilityError(args),
  };
}

export function summarizeCredentialCompatibilityError(args: {
  model: string;
  provider: LlmProvider;
  credentialMode?: ModelCredentialMode;
}): string | undefined {
  if (args.provider === 'openai' && args.credentialMode === 'oauth' && !isOpenAiAccountSignInModel(args.model)) {
    return OPENAI_OAUTH_DISABLED_REASON;
  }

  return undefined;
}

export function resolveCompatibleActiveModel(args: {
  activeModel: string;
  provider: LlmProvider;
  credentialMode?: ModelCredentialMode;
}): { model: string; warning?: string } {
  const compatibility = validateModelCredentialCompatibility({
    model: args.activeModel,
    provider: args.provider,
    credentialMode: args.credentialMode,
  });
  if (compatibility.ok) {
    return { model: args.activeModel };
  }

  const fallback = resolveSystemSelectedModel({
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

export function formatOpenAiAccountSignInModels(): string {
  return OPENAI_ACCOUNT_SIGN_IN_MODELS.join(', ');
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models)];
}

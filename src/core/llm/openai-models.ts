// ---------------------------------------------------------------------------
// Built-in model shortlist used by Heddle's current UI and local commands.
// Keep this curated rather than mirroring the entire provider catalog.
// ---------------------------------------------------------------------------

export type BuiltInModelGroup = {
  label: string;
  models: string[];
};

export const BUILT_IN_MODEL_GROUPS: BuiltInModelGroup[] = [
  {
    label: 'OpenAI · GPT-5.5',
    models: ['gpt-5.5', 'gpt-5.5-pro'],
  },
  {
    label: 'OpenAI · GPT-5.4',
    models: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  },
  {
    label: 'OpenAI · GPT-5 family',
    models: ['gpt-5', 'gpt-5-pro', 'gpt-5-mini', 'gpt-5-nano'],
  },
  {
    label: 'OpenAI · Earlier GPT-5 releases',
    models: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1'],
  },
  {
    label: 'OpenAI · GPT-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
  },
  {
    label: 'OpenAI · Reasoning series',
    models: ['o3-pro', 'o3', 'o3-mini', 'o4-mini'],
  },
  {
    label: 'OpenAI · Coding-optimized',
    models: ['gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'],
  },
  {
    label: 'Anthropic · Claude 4',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    label: 'Anthropic · Earlier Claude 4',
    models: ['claude-opus-4-1', 'claude-opus-4-0', 'claude-sonnet-4-0'],
  },
  {
    label: 'Anthropic · Claude 3.7',
    models: ['claude-3-7-sonnet-latest'],
  },
  {
    label: 'Anthropic · Claude 3.5',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  },
];

export const OPENAI_MODEL_GROUPS: BuiltInModelGroup[] = BUILT_IN_MODEL_GROUPS.filter((group) =>
  group.label.startsWith('OpenAI · '),
);

export const COMMON_BUILT_IN_MODELS = BUILT_IN_MODEL_GROUPS.flatMap((group) => group.models);
export const COMMON_OPENAI_MODELS = OPENAI_MODEL_GROUPS.flatMap((group) => group.models);
export const OPENAI_ACCOUNT_SIGN_IN_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
];

const BUILT_IN_CONTEXT_WINDOW_ESTIMATES = new Map<string, number>(
  COMMON_BUILT_IN_MODELS.map((model) => [model, inferContextWindowEstimate(model)]),
);

export function formatOpenAiModelGroups(): string {
  return OPENAI_MODEL_GROUPS
    .map((group) => [
      group.label.replace(/^OpenAI · /, ''),
      ...group.models.map((model) => `  - ${model}`),
    ].join('\n'))
    .join('\n\n');
}

export function formatBuiltInModelGroups(): string {
  return BUILT_IN_MODEL_GROUPS
    .map((group) => [
      `${group.label}`,
      ...group.models.map((model) => `  - ${model}`),
    ].join('\n'))
    .join('\n\n');
}

export function filterOpenAiModels(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return COMMON_OPENAI_MODELS;
  }

  return COMMON_OPENAI_MODELS.filter((model) => model.toLowerCase().includes(normalized));
}

export function isOpenAiAccountSignInModel(model: string): boolean {
  return OPENAI_ACCOUNT_SIGN_IN_MODELS.includes(model.trim());
}

export function filterBuiltInModels(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return COMMON_BUILT_IN_MODELS;
  }

  return COMMON_BUILT_IN_MODELS.filter((model) => model.toLowerCase().includes(normalized));
}

export function estimateOpenAiContextWindow(model: string): number | undefined {
  return estimateBuiltInContextWindow(model);
}

export function estimateBuiltInContextWindow(model: string): number | undefined {
  const normalized = model.trim();
  if (!normalized) {
    return undefined;
  }

  return BUILT_IN_CONTEXT_WINDOW_ESTIMATES.get(normalized) ?? inferContextWindowEstimate(normalized);
}

function inferContextWindowEstimate(model: string): number {
  if (model.startsWith('gpt-5.5')) {
    return 400_000;
  }

  if (model === 'gpt-5.4' || model === 'gpt-5.4-pro') {
    return 400_000;
  }

  if (model === 'gpt-5.4-mini') {
    return 400_000;
  }

  if (model.startsWith('gpt-5.1') || model.startsWith('gpt-5.2') || model.startsWith('gpt-5.3') || model.startsWith('gpt-5-') || model === 'gpt-5') {
    return 400_000;
  }

  if (model.startsWith('gpt-4.1')) {
    return 128_000;
  }

  return 200_000;
}

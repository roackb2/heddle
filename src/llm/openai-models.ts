// ---------------------------------------------------------------------------
// Built-in model shortlist used by Heddle's current UI and local commands.
// Keep this curated rather than mirroring the entire provider catalog.
// Phase 0 keeps the current OpenAI-backed behavior while exposing more
// provider-neutral helper names for future providers.
// ---------------------------------------------------------------------------

export type OpenAiModelGroup = {
  label: string;
  models: string[];
};

export const OPENAI_MODEL_GROUPS: OpenAiModelGroup[] = [
  {
    label: 'GPT-5.4',
    models: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  },
  {
    label: 'GPT-5 family',
    models: ['gpt-5', 'gpt-5-pro', 'gpt-5-mini', 'gpt-5-nano'],
  },
  {
    label: 'Earlier GPT-5 releases',
    models: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1'],
  },
  {
    label: 'GPT-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
  },
  {
    label: 'Reasoning series',
    models: ['o3-pro', 'o3', 'o3-mini', 'o4-mini'],
  },
  {
    label: 'Coding-optimized',
    models: ['gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'],
  },
];

export const COMMON_OPENAI_MODELS = OPENAI_MODEL_GROUPS.flatMap((group) => group.models);
export const COMMON_BUILT_IN_MODELS = COMMON_OPENAI_MODELS;

const OPENAI_CONTEXT_WINDOW_ESTIMATES = new Map<string, number>(
  COMMON_BUILT_IN_MODELS.map((model) => [model, inferContextWindowEstimate(model)]),
);

export function formatOpenAiModelGroups(): string {
  return formatBuiltInModelGroups();
}

export function formatBuiltInModelGroups(): string {
  return OPENAI_MODEL_GROUPS.map((group) => `${group.label}: ${group.models.join(', ')}`).join('\n');
}

export function filterOpenAiModels(query: string): string[] {
  return filterBuiltInModels(query);
}

export function filterBuiltInModels(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return COMMON_OPENAI_MODELS;
  }

  return COMMON_OPENAI_MODELS.filter((model) => model.toLowerCase().includes(normalized));
}

export function estimateOpenAiContextWindow(model: string): number | undefined {
  return estimateBuiltInContextWindow(model);
}

export function estimateBuiltInContextWindow(model: string): number | undefined {
  const normalized = model.trim();
  if (!normalized) {
    return undefined;
  }

  return OPENAI_CONTEXT_WINDOW_ESTIMATES.get(normalized) ?? inferContextWindowEstimate(normalized);
}

function inferContextWindowEstimate(model: string): number {
  if (model.startsWith('gpt-4.1')) {
    return 128_000;
  }

  return 200_000;
}

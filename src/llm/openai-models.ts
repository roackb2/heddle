// ---------------------------------------------------------------------------
// OpenAI model shortlist used by Heddle's UI and local commands.
// Keep this curated rather than mirroring the entire API catalog.
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

export function formatOpenAiModelGroups(): string {
  return OPENAI_MODEL_GROUPS.map((group) => `${group.label}: ${group.models.join(', ')}`).join('\n');
}

export function filterOpenAiModels(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return COMMON_OPENAI_MODELS;
  }

  return COMMON_OPENAI_MODELS.filter((model) => model.toLowerCase().includes(normalized));
}

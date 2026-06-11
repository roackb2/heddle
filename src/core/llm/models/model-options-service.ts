import type { LlmProvider } from '@/core/llm/types.js';
import {
  OpenAiCompatibleModelDiscoveryService,
  type OpenAiCompatibleModelDiscoverySource,
} from '@/core/llm/adapters/openai-compatible/index.js';
import { LlmProviderInference } from '../registry/provider-inference.js';
import {
  BUILT_IN_MODEL_GROUPS,
  type BuiltInModelGroup,
  type ModelCatalogResolutionContext,
  type ModelOptionGroup,
} from './model-catalog.js';
import { ModelPolicyService, type ModelCredentialMode } from './model-policy-service.js';

/**
 * Resolves the shared model picker contract for control-plane clients. Static
 * provider shortlists and local provider discovery meet here so TUI, web, task
 * forms, and slash-command pickers render the same provider-aware model list.
 */
export class ModelOptionsService {
  static async resolve(context: ModelCatalogResolutionContext = {}): Promise<{ groups: ModelOptionGroup[] }> {
    const credentialModes = context.credentialModes ?? {};
    const builtInGroups = BUILT_IN_MODEL_GROUPS.map((group) => ModelOptionsService.toBuiltInModelOptionGroup(group, credentialModes));
    const discoveredGroups = await ModelOptionsService.resolveDiscoveredModelOptionGroups(context);

    return {
      groups: [
        ...builtInGroups,
        ...discoveredGroups,
      ],
    };
  }

  private static toBuiltInModelOptionGroup(
    group: BuiltInModelGroup,
    credentialModes: Partial<Record<LlmProvider, ModelCredentialMode>>,
  ): ModelOptionGroup {
    const options = group.models.map((model) => {
      const provider = LlmProviderInference.inferBuiltin(model);
      return ModelPolicyService.buildCredentialAwareModelOption({
        model,
        provider,
        credentialMode: credentialModes[provider],
      });
    });

    return {
      label: group.label,
      models: group.models,
      options,
      source: 'built-in',
    };
  }

  private static async resolveDiscoveredModelOptionGroups(context: ModelCatalogResolutionContext): Promise<ModelOptionGroup[]> {
    const sources = context.openAiCompatibleSources ?? [];
    const groups = await Promise.all(sources.map((source) => ModelOptionsService.resolveOpenAiCompatibleModelOptionGroup(source, context)));
    return groups.flatMap((group) => group ?? []);
  }

  private static async resolveOpenAiCompatibleModelOptionGroup(
    source: OpenAiCompatibleModelDiscoverySource,
    context: ModelCatalogResolutionContext,
  ): Promise<ModelOptionGroup | undefined> {
    try {
      const models = await OpenAiCompatibleModelDiscoveryService.listModels({
        ...source,
        fetchImpl: context.fetchImpl,
        signal: context.signal,
      });
      if (models.length === 0) {
        return undefined;
      }

      return {
        label: source.profile.modelDiscovery.label,
        models: models.map((model) => model.id),
        options: models.map((model) => ModelPolicyService.buildCredentialAwareModelOption({
          model: model.id,
          provider: source.profile.id,
          label: model.name,
          credentialMode: 'api-key',
        })),
        source: source.profile.modelDiscovery.source,
      };
    } catch {
      return undefined;
    }
  }
}

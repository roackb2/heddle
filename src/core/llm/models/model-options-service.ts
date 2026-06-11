import type { LlmProvider } from '@/core/llm/types.js';
import { OllamaModelDiscoveryService } from '@/core/llm/adapters/ollama/ollama-model-discovery.js';
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
    const localGroups = await ModelOptionsService.resolveLocalModelOptionGroups(context);

    return {
      groups: [
        ...builtInGroups,
        ...localGroups,
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

  private static async resolveLocalModelOptionGroups(context: ModelCatalogResolutionContext): Promise<ModelOptionGroup[]> {
    const ollamaModels = await ModelOptionsService.discoverOllamaModels(context);
    if (ollamaModels.length === 0) {
      return [];
    }

    return [{
      label: 'Ollama · Installed local models',
      models: ollamaModels.map((model) => model.id),
      options: ollamaModels.map((model) => ModelPolicyService.buildCredentialAwareModelOption({
        model: model.id,
        provider: 'ollama',
        label: model.name,
        credentialMode: 'api-key',
      })),
      source: 'local-discovered',
    }];
  }

  private static async discoverOllamaModels(context: ModelCatalogResolutionContext) {
    if (!context.ollamaBaseUrl) {
      return [];
    }

    try {
      return await OllamaModelDiscoveryService.listInstalledModels({
        baseUrl: context.ollamaBaseUrl,
        fetchImpl: context.fetchImpl,
        signal: context.signal,
      });
    } catch {
      return [];
    }
  }
}

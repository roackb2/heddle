import { OpenAiCompatibleModelName } from './openai-compatible-model.js';
import type { OpenAiCompatibleModelDiscoverySource, OpenAiCompatibleProviderProfile } from './types.js';

export type OpenAiCompatibleDiscoveredModel = {
  id: string;
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
};

export type OpenAiCompatibleModelDiscoveryOptions = OpenAiCompatibleModelDiscoverySource & {
  fetchImpl?: (url: unknown, init?: unknown) => Promise<globalThis.Response>;
  signal?: AbortSignal;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: unknown;
    size?: unknown;
    modified_at?: unknown;
    capabilities?: unknown;
  }>;
};

type OpenAiModelsResponse = {
  data?: Array<{
    id?: unknown;
  }>;
};

/**
 * Discovers profile-owned models without shelling out. Local providers use
 * their HTTP endpoints, and hosted providers use their OpenAI-compatible
 * `/models` endpoint when the required credentials are configured.
 */
export class OpenAiCompatibleModelDiscoveryService {
  static async listModels(options: OpenAiCompatibleModelDiscoveryOptions): Promise<OpenAiCompatibleDiscoveredModel[]> {
    if (options.profile.modelDiscovery.mode === 'ollama-tags') {
      return await OpenAiCompatibleModelDiscoveryService.listOllamaTags(options);
    }

    return await OpenAiCompatibleModelDiscoveryService.listOpenAiModels(options);
  }

  private static async listOllamaTags(options: OpenAiCompatibleModelDiscoveryOptions): Promise<OpenAiCompatibleDiscoveredModel[]> {
    const response = await (options.fetchImpl ?? fetch)(`${OpenAiCompatibleModelDiscoveryService.trimTrailingSlash(options.nativeBaseUrl ?? OpenAiCompatibleModelDiscoveryService.openAiToNativeBaseUrl(options.baseUrl))}/api/tags`, {
      method: 'GET',
      signal: options.signal,
    });
    const payload = await OpenAiCompatibleModelDiscoveryService.readJsonResponse<OllamaTagsResponse>(response, options.profile);

    return (payload.models ?? [])
      .flatMap((model) => OpenAiCompatibleModelDiscoveryService.toOllamaDiscoveredModel(options.profile, model) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private static async listOpenAiModels(options: OpenAiCompatibleModelDiscoveryOptions): Promise<OpenAiCompatibleDiscoveredModel[]> {
    const response = await (options.fetchImpl ?? fetch)(`${OpenAiCompatibleModelDiscoveryService.trimTrailingSlash(options.baseUrl)}/models`, {
      method: 'GET',
      signal: options.signal,
      headers: OpenAiCompatibleModelDiscoveryService.headers(options.apiKey),
    });
    const payload = await OpenAiCompatibleModelDiscoveryService.readJsonResponse<OpenAiModelsResponse>(response, options.profile);

    return (payload.data ?? [])
      .flatMap((model) => OpenAiCompatibleModelDiscoveryService.toOpenAiDiscoveredModel(options.profile, model) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private static toOllamaDiscoveredModel(
    profile: OpenAiCompatibleProviderProfile,
    model: NonNullable<OllamaTagsResponse['models']>[number],
  ): OpenAiCompatibleDiscoveredModel | undefined {
    if (typeof model.name !== 'string' || !model.name.trim()) {
      return undefined;
    }

    if (!OpenAiCompatibleModelDiscoveryService.isChatCapable(model.capabilities)) {
      return undefined;
    }

    return {
      id: OpenAiCompatibleModelName.toHeddleModel(profile, model.name),
      name: model.name.trim(),
      sizeBytes: typeof model.size === 'number' ? model.size : undefined,
      modifiedAt: typeof model.modified_at === 'string' ? model.modified_at : undefined,
    };
  }

  private static toOpenAiDiscoveredModel(
    profile: OpenAiCompatibleProviderProfile,
    model: NonNullable<OpenAiModelsResponse['data']>[number],
  ): OpenAiCompatibleDiscoveredModel | undefined {
    if (typeof model.id !== 'string' || !model.id.trim() || OpenAiCompatibleModelDiscoveryService.isEmbeddingModel(model.id)) {
      return undefined;
    }

    const name = model.id.trim();
    return {
      id: OpenAiCompatibleModelName.toHeddleModel(profile, name),
      name,
    };
  }

  private static isChatCapable(capabilities: unknown): boolean {
    if (!Array.isArray(capabilities)) {
      return true;
    }

    return capabilities.some((capability) => capability === 'completion' || capability === 'chat');
  }

  private static isEmbeddingModel(name: string): boolean {
    const normalized = name.toLowerCase();
    return ['embed', 'embedding', 'nomic-embed', 'bge', 'clip'].some((part) => normalized.includes(part));
  }

  private static async readJsonResponse<T>(response: globalThis.Response, profile: OpenAiCompatibleProviderProfile): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${profile.label} model discovery request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
    }

    const parsed = text.trim() ? JSON.parse(text) as unknown : {};
    return typeof parsed === 'object' && parsed !== null ? parsed as T : {} as T;
  }

  private static headers(apiKey: string | undefined): Record<string, string> | undefined {
    return apiKey ? { authorization: `Bearer ${apiKey}` } : undefined;
  }

  private static trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
  }

  private static openAiToNativeBaseUrl(value: string): string {
    return OpenAiCompatibleModelDiscoveryService.trimTrailingSlash(value).replace(/\/v1$/i, '');
  }
}

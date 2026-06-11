import { OllamaModelName } from './ollama-model.js';

export type OllamaDiscoveredModel = {
  id: string;
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
};

export type OllamaModelDiscoveryOptions = {
  baseUrl: string;
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

/**
 * Discovers installed Ollama models through Ollama's local HTTP API. This
 * provider-owned service avoids shelling out to `ollama list`, so control-plane
 * clients, daemon hosts, and tests all use the same endpoint-based behavior.
 */
export class OllamaModelDiscoveryService {
  static async listInstalledModels(options: OllamaModelDiscoveryOptions): Promise<OllamaDiscoveredModel[]> {
    const response = await (options.fetchImpl ?? fetch)(`${OllamaModelDiscoveryService.trimTrailingSlash(options.baseUrl)}/api/tags`, {
      method: 'GET',
      signal: options.signal,
    });
    const payload = await OllamaModelDiscoveryService.readJsonResponse(response);

    return (payload.models ?? [])
      .flatMap((model) => OllamaModelDiscoveryService.toDiscoveredModel(model) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private static toDiscoveredModel(model: NonNullable<OllamaTagsResponse['models']>[number]): OllamaDiscoveredModel | undefined {
    if (typeof model.name !== 'string' || !model.name.trim()) {
      return undefined;
    }

    if (!OllamaModelDiscoveryService.isChatCapable(model.capabilities)) {
      return undefined;
    }

    return {
      id: OllamaModelName.toHeddleModel(model.name),
      name: model.name.trim(),
      sizeBytes: typeof model.size === 'number' ? model.size : undefined,
      modifiedAt: typeof model.modified_at === 'string' ? model.modified_at : undefined,
    };
  }

  private static isChatCapable(capabilities: unknown): boolean {
    if (!Array.isArray(capabilities)) {
      return true;
    }

    return capabilities.some((capability) => capability === 'completion' || capability === 'chat');
  }

  private static async readJsonResponse(response: globalThis.Response): Promise<OllamaTagsResponse> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Ollama model discovery request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
    }

    const parsed = text.trim() ? JSON.parse(text) as unknown : {};
    return typeof parsed === 'object' && parsed !== null ? parsed as OllamaTagsResponse : {};
  }

  private static trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
  }
}

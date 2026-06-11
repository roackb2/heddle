import {
  OpenAiCompatibleModelDiscoveryService,
  type OpenAiCompatibleDiscoveredModel,
  type OpenAiCompatibleModelDiscoveryOptions,
} from '../openai-compatible/index.js';
import { OpenAiCompatibleProviderProfileService } from '../openai-compatible/openai-compatible-profiles.js';

export type OllamaDiscoveredModel = OpenAiCompatibleDiscoveredModel;

export type OllamaModelDiscoveryOptions = {
  baseUrl: string;
  fetchImpl?: (url: unknown, init?: unknown) => Promise<globalThis.Response>;
  signal?: AbortSignal;
};

/**
 * Discovers installed Ollama models through Ollama's local HTTP API. This
 * provider-owned service avoids shelling out to `ollama list`, so control-plane
 * clients, daemon hosts, and tests all use the same endpoint-based behavior.
 */
export class OllamaModelDiscoveryService {
  static async listInstalledModels(options: OllamaModelDiscoveryOptions): Promise<OllamaDiscoveredModel[]> {
    return await OpenAiCompatibleModelDiscoveryService.listModels({
      profile: OpenAiCompatibleProviderProfileService.get('ollama'),
      baseUrl: options.baseUrl,
      nativeBaseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    } satisfies OpenAiCompatibleModelDiscoveryOptions);
  }
}

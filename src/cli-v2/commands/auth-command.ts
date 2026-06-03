import type { LlmProvider } from '@/core/llm/types.js';
import {
  ProviderCredentialCommandService,
  type ProviderCredentialCommandOptions,
} from '@/core/auth/index.js';

export type AuthCliCommand = 'status' | 'logout' | 'login';
export type AuthCliOptions = ProviderCredentialCommandOptions;

const SUPPORTED_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);

/**
 * Command edge for `heddle auth`.
 *
 * Owns: terminal provider parsing, command selection, authorization URL output,
 * and final status/login/logout messages.
 *
 * Does not own: credential storage, OAuth flow semantics, provider status
 * calculation, or logout policy. Those belong to
 * ProviderCredentialCommandService's public command-facing contract.
 */
export class AuthCliCommandEdgeService {
  static async run(command: AuthCliCommand, provider?: string, options: AuthCliOptions = {}) {
    if (command === 'status') {
      process.stdout.write(ProviderCredentialCommandService.formatStatusMessage(options.storePath));
      process.stdout.write('\n');
      return;
    }

    const normalizedProvider = AuthCliCommandEdgeService.parseProvider(provider);
    if (command === 'login') {
      process.stdout.write('Starting OpenAI ChatGPT/Codex OAuth login...\n');
      process.stdout.write(await ProviderCredentialCommandService.loginProviderWithOAuth(normalizedProvider, {
        ...options,
        onAuthorizeUrl: (url) => {
          process.stdout.write(`Open this URL to authorize Heddle:\n${url}\n`);
        },
      }));
      process.stdout.write('\n');
      return;
    }

    process.stdout.write(ProviderCredentialCommandService.logoutProvider(normalizedProvider, options.storePath));
    process.stdout.write('\n');
  }

  private static parseProvider(provider: string | undefined): LlmProvider {
    if (!provider) {
      throw new Error('Usage: heddle auth <login|logout> <provider>');
    }

    const normalized = provider.trim().toLowerCase();
    if (!SUPPORTED_PROVIDERS.has(normalized as LlmProvider)) {
      throw new Error(`Unsupported auth provider: ${provider}`);
    }

    return normalized as LlmProvider;
  }
}

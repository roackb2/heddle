import type { LlmProvider } from '@/core/llm/types.js';
import {
  ProviderCredentialCommandService,
  type ProviderCredentialCommandOptions,
} from '@/core/auth/index.js';

export type AuthCliCommand = 'status' | 'logout' | 'login';
export type AuthCliOptions = ProviderCredentialCommandOptions;

const SUPPORTED_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);

/**
 * Terminal adapter for provider credential commands. Core auth owns status,
 * login, logout, and persistence semantics; this class owns CLI parsing and
 * terminal output.
 */
export class AuthCliController {
  static async run(command: AuthCliCommand, provider?: string, options: AuthCliOptions = {}) {
    if (command === 'status') {
      process.stdout.write(AuthCliController.formatStatusMessage(options.storePath));
      process.stdout.write('\n');
      return;
    }

    const normalizedProvider = AuthCliController.parseProvider(provider);
    if (command === 'login') {
      process.stdout.write('Starting OpenAI ChatGPT/Codex OAuth login...\n');
      process.stdout.write(await AuthCliController.loginProviderWithOAuth(normalizedProvider, {
        ...options,
        onAuthorizeUrl: (url) => {
          process.stdout.write(`Open this URL to authorize Heddle:\n${url}\n`);
        },
      }));
      process.stdout.write('\n');
      return;
    }

    process.stdout.write(AuthCliController.logoutProvider(normalizedProvider, options.storePath));
    process.stdout.write('\n');
  }

  static formatStatusMessage(storePath?: string): string {
    return ProviderCredentialCommandService.formatStatusMessage(storePath);
  }

  static loginProviderWithOAuth(provider: LlmProvider, options: AuthCliOptions = {}): Promise<string> {
    return ProviderCredentialCommandService.loginProviderWithOAuth(provider, options);
  }

  static logoutProvider(provider: LlmProvider, storePath?: string): string {
    return ProviderCredentialCommandService.logoutProvider(provider, storePath);
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

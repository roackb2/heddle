import type { LlmProvider } from '../core/llm/types.js';
import {
  OpenAiOAuthService,
  ProviderCredentialRepository,
  type OpenAiOAuthCredential,
} from '../core/auth/index.js';

export type AuthCliCommand = 'status' | 'logout' | 'login';

export type AuthCliOptions = {
  storePath?: string;
  openBrowser?: boolean;
  openAiLogin?: () => Promise<OpenAiOAuthCredential>;
};

const SUPPORTED_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);

/**
 * CLI controller for auth commands. Core auth owns persistence and OAuth; this
 * class owns command parsing plus terminal-oriented status/login/logout output.
 */
export class AuthCliController {
  static async run(command: AuthCliCommand, provider?: string, options: AuthCliOptions = {}) {
    const storePath = options.storePath ?? ProviderCredentialRepository.resolveStorePath();

    if (command === 'status') {
      process.stdout.write(AuthCliController.formatStatusMessage(storePath));
      process.stdout.write('\n');
      return;
    }

    const normalizedProvider = AuthCliController.parseProvider(provider);
    if (command === 'login') {
      process.stdout.write('Starting OpenAI ChatGPT/Codex OAuth login...\n');
      process.stdout.write(await AuthCliController.loginProviderWithOAuth(normalizedProvider, {
        ...options,
        storePath,
        onAuthorizeUrl: (url) => {
          process.stdout.write(`Open this URL to authorize Heddle:\n${url}\n`);
        },
      }));
      process.stdout.write('\n');
      return;
    }

    process.stdout.write(AuthCliController.logoutProvider(normalizedProvider, storePath));
    process.stdout.write('\n');
  }

  static formatStatusMessage(storePath = ProviderCredentialRepository.resolveStorePath()): string {
    const summaries = new ProviderCredentialRepository({ storePath }).listSummaries();
    const lines = [`Auth store: ${storePath}`];

    if (summaries.length === 0) {
      return [...lines, 'Stored credentials: none'].join('\n');
    }

    lines.push('Stored credentials:');
    for (const summary of summaries) {
      const details = [
        `type=${summary.type}`,
        summary.label ? `label=${summary.label}` : undefined,
        summary.accountId ? `account=${summary.accountId}` : undefined,
        summary.expiresAt ? `expires=${new Date(summary.expiresAt).toISOString()}` : undefined,
        summary.expired === true ? 'expired=true' : undefined,
        `updated=${summary.updatedAt}`,
      ].filter(Boolean);
      lines.push(`- ${summary.provider}: ${details.join(' ')}`);
    }
    return lines.join('\n');
  }

  static async loginProviderWithOAuth(
    provider: LlmProvider,
    options: AuthCliOptions & { onAuthorizeUrl?: (url: string) => void } = {},
  ): Promise<string> {
    const storePath = options.storePath ?? ProviderCredentialRepository.resolveStorePath();
    if (provider !== 'openai') {
      throw new Error(`OAuth login is not available for ${provider}. Use API keys or supported provider credentials.`);
    }

    const credential = await (options.openAiLogin ?? (() => OpenAiOAuthService.runBrowserLogin({
      openBrowser: options.openBrowser,
      onAuthorizeUrl: options.onAuthorizeUrl,
    })))();
    new ProviderCredentialRepository({ storePath }).set(credential);

    return [
      'Stored OpenAI OAuth credential.',
      credential.accountId ? `Account: ${credential.accountId}` : undefined,
      `Expires: ${new Date(credential.expiresAt).toISOString()}`,
    ].filter((line): line is string => Boolean(line)).join('\n');
  }

  static logoutProvider(provider: LlmProvider, storePath = ProviderCredentialRepository.resolveStorePath()): string {
    const removed = new ProviderCredentialRepository({ storePath }).remove(provider);
    return removed ?
        `Removed stored ${provider} credential.`
      : `No stored ${provider} credential found.`;
  }

  private static parseProvider(provider: string | undefined): LlmProvider {
    if (!provider) {
      throw new Error('Usage: heddle auth logout <provider>');
    }

    const normalized = provider.trim().toLowerCase();
    if (!SUPPORTED_PROVIDERS.has(normalized as LlmProvider)) {
      throw new Error(`Unsupported auth provider: ${provider}`);
    }

    return normalized as LlmProvider;
  }
}

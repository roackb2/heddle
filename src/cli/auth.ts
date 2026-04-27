import type { LlmProvider } from '../core/llm/types.js';
import { runOpenAiBrowserOAuthLogin, type OpenAiOAuthCredential } from '../core/auth/openai-oauth.js';
import {
  listStoredProviderCredentialSummaries,
  removeStoredProviderCredential,
  resolveProviderCredentialStorePath,
  setStoredProviderCredential,
} from '../core/auth/provider-credentials.js';

export type AuthCliCommand = 'status' | 'logout' | 'login';

export type AuthCliOptions = {
  storePath?: string;
  openBrowser?: boolean;
  openAiLogin?: () => Promise<OpenAiOAuthCredential>;
};

const SUPPORTED_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);

export async function runAuthCli(command: AuthCliCommand, provider?: string, options: AuthCliOptions = {}) {
  const storePath = options.storePath ?? resolveProviderCredentialStorePath();

  if (command === 'status') {
    process.stdout.write(formatAuthStatusMessage(storePath));
    process.stdout.write('\n');
    return;
  }

  const normalizedProvider = parseProvider(provider);
  if (command === 'login') {
    process.stdout.write('Starting OpenAI ChatGPT/Codex OAuth login...\n');
    process.stdout.write(await loginProviderWithOAuth(normalizedProvider, {
      ...options,
      storePath,
      onAuthorizeUrl: (url) => {
        process.stdout.write(`Open this URL to authorize Heddle:\n${url}\n`);
      },
    }));
    process.stdout.write('\n');
    return;
  }

  process.stdout.write(logoutProvider(normalizedProvider, storePath));
  process.stdout.write('\n');
}

export function formatAuthStatusMessage(storePath = resolveProviderCredentialStorePath()): string {
  const summaries = listStoredProviderCredentialSummaries(storePath);
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

export async function loginProviderWithOAuth(
  provider: LlmProvider,
  options: AuthCliOptions & { onAuthorizeUrl?: (url: string) => void } = {},
): Promise<string> {
  const storePath = options.storePath ?? resolveProviderCredentialStorePath();
  if (provider !== 'openai') {
    throw new Error(`OAuth login is not available for ${provider}. Use API keys or supported provider credentials.`);
  }

  const credential = await (options.openAiLogin ?? (() => runOpenAiBrowserOAuthLogin({
    openBrowser: options.openBrowser,
    onAuthorizeUrl: options.onAuthorizeUrl,
  })))();
  setStoredProviderCredential(credential, storePath);

  return [
    'Stored OpenAI OAuth credential.',
    credential.accountId ? `Account: ${credential.accountId}` : undefined,
    `Expires: ${new Date(credential.expiresAt).toISOString()}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function logoutProvider(provider: LlmProvider, storePath = resolveProviderCredentialStorePath()): string {
  const removed = removeStoredProviderCredential(provider, storePath);
  return removed ?
      `Removed stored ${provider} credential.`
    : `No stored ${provider} credential found.`;
}

function parseProvider(provider: string | undefined): LlmProvider {
  if (!provider) {
    throw new Error('Usage: heddle auth logout <provider>');
  }

  const normalized = provider.trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalized as LlmProvider)) {
    throw new Error(`Unsupported auth provider: ${provider}`);
  }

  return normalized as LlmProvider;
}

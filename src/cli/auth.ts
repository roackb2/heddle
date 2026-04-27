import type { LlmProvider } from '../core/llm/types.js';
import {
  listStoredProviderCredentialSummaries,
  removeStoredProviderCredential,
  resolveProviderCredentialStorePath,
} from '../core/auth/provider-credentials.js';

export type AuthCliCommand = 'status' | 'logout';

export type AuthCliOptions = {
  storePath?: string;
};

const SUPPORTED_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);

export async function runAuthCli(command: AuthCliCommand, provider?: string, options: AuthCliOptions = {}) {
  const storePath = options.storePath ?? resolveProviderCredentialStorePath();

  if (command === 'status') {
    writeAuthStatus(storePath);
    return;
  }

  const normalizedProvider = parseProvider(provider);
  const removed = removeStoredProviderCredential(normalizedProvider, storePath);
  process.stdout.write(
    removed ?
      `Removed stored ${normalizedProvider} credential.\n`
    : `No stored ${normalizedProvider} credential found.\n`,
  );
}

function writeAuthStatus(storePath: string) {
  const summaries = listStoredProviderCredentialSummaries(storePath);
  process.stdout.write(`Auth store: ${storePath}\n`);

  if (summaries.length === 0) {
    process.stdout.write('Stored credentials: none\n');
    return;
  }

  process.stdout.write('Stored credentials:\n');
  for (const summary of summaries) {
    const details = [
      `type=${summary.type}`,
      summary.label ? `label=${summary.label}` : undefined,
      summary.accountId ? `account=${summary.accountId}` : undefined,
      summary.expiresAt ? `expires=${new Date(summary.expiresAt).toISOString()}` : undefined,
      summary.expired === true ? 'expired=true' : undefined,
      `updated=${summary.updatedAt}`,
    ].filter(Boolean);
    process.stdout.write(`- ${summary.provider}: ${details.join(' ')}\n`);
  }
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

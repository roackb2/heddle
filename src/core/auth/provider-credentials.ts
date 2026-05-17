import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LlmProvider } from '@/core/llm/types.js';
import { ProviderCredentialSchemas } from './schemas.js';
import type {
  ProviderCredentialStore,
  ProviderCredentialSummary,
  StoredProviderCredential,
} from './types.js';

/**
 * File-backed repository for provider credentials. It owns the auth.json path,
 * zod-backed deserialization, private file permissions, and redacted views.
 */
export class ProviderCredentialRepository {
  private readonly storePath: string;

  constructor(input: { storePath?: string } = {}) {
    this.storePath = input.storePath ?? ProviderCredentialRepository.resolveStorePath();
  }

  static resolveStorePath(baseDir = join(homedir(), '.heddle')): string {
    return join(baseDir, 'auth.json');
  }

  static emptyStore(): ProviderCredentialStore {
    return ProviderCredentialSchemas.emptyStore();
  }

  static summarize(credential: StoredProviderCredential): ProviderCredentialSummary {
    return {
      provider: credential.provider,
      type: credential.type,
      label: credential.label,
      accountId: credential.type === 'oauth' ? credential.accountId : undefined,
      expiresAt: credential.type === 'oauth' ? credential.expiresAt : undefined,
      expired: credential.type === 'oauth' ? credential.expiresAt <= Date.now() : undefined,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }

  static redact(credential: StoredProviderCredential): Record<string, unknown> {
    const summary = ProviderCredentialRepository.summarize(credential);
    return {
      ...summary,
      key: credential.type === 'api-key' ? ProviderCredentialRepository.redactSecret(credential.key) : undefined,
      token: credential.type === 'bearer' ? ProviderCredentialRepository.redactSecret(credential.token) : undefined,
      accessToken: credential.type === 'oauth' ? ProviderCredentialRepository.redactSecret(credential.accessToken) : undefined,
      refreshToken: credential.type === 'oauth' ? ProviderCredentialRepository.redactSecret(credential.refreshToken) : undefined,
    };
  }

  static redactSecret(secret: string): string {
    if (secret.length <= 8) {
      return '<redacted>';
    }

    return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
  }

  read(): ProviderCredentialStore {
    if (!existsSync(this.storePath)) {
      return ProviderCredentialRepository.emptyStore();
    }

    try {
      return ProviderCredentialSchemas.parseStore(JSON.parse(readFileSync(this.storePath, 'utf8')) as unknown);
    } catch {
      return ProviderCredentialRepository.emptyStore();
    }
  }

  write(store: ProviderCredentialStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSync(this.storePath, 0o600);
  }

  get(provider: LlmProvider): StoredProviderCredential | undefined {
    return this.read().credentials[provider];
  }

  set(credential: StoredProviderCredential): void {
    const store = this.read();
    store.credentials[credential.provider] = credential;
    this.write(store);
  }

  remove(provider: LlmProvider): boolean {
    const store = this.read();
    const existed = Boolean(store.credentials[provider]);
    delete store.credentials[provider];
    this.write(store);
    return existed;
  }

  listSummaries(): ProviderCredentialSummary[] {
    return Object.values(this.read().credentials)
      .filter((credential): credential is StoredProviderCredential => Boolean(credential))
      .map(ProviderCredentialRepository.summarize)
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }
}

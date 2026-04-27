import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LlmProvider } from '../llm/types.js';

export type StoredProviderCredential =
  | {
      type: 'api-key';
      provider: LlmProvider;
      key: string;
      createdAt: string;
      updatedAt: string;
      label?: string;
    }
  | {
      type: 'bearer';
      provider: LlmProvider;
      token: string;
      createdAt: string;
      updatedAt: string;
      label?: string;
    }
  | {
      type: 'oauth';
      provider: LlmProvider;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      createdAt: string;
      updatedAt: string;
      accountId?: string;
      label?: string;
    };

export type ProviderCredentialStore = {
  version: 1;
  credentials: Partial<Record<LlmProvider, StoredProviderCredential>>;
};

export type ProviderCredentialSummary = {
  provider: LlmProvider;
  type: StoredProviderCredential['type'];
  label?: string;
  accountId?: string;
  expiresAt?: number;
  expired?: boolean;
  createdAt: string;
  updatedAt: string;
};

const SUPPORTED_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);
const SUPPORTED_TYPES = new Set<StoredProviderCredential['type']>(['api-key', 'bearer', 'oauth']);

export function resolveProviderCredentialStorePath(baseDir = join(homedir(), '.heddle')): string {
  return join(baseDir, 'auth.json');
}

export function createEmptyProviderCredentialStore(): ProviderCredentialStore {
  return {
    version: 1,
    credentials: {},
  };
}

export function readProviderCredentialStore(path = resolveProviderCredentialStorePath()): ProviderCredentialStore {
  if (!existsSync(path)) {
    return createEmptyProviderCredentialStore();
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return parseProviderCredentialStore(parsed);
}

export function writeProviderCredentialStore(store: ProviderCredentialStore, path = resolveProviderCredentialStorePath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

export function getStoredProviderCredential(
  provider: LlmProvider,
  path = resolveProviderCredentialStorePath(),
): StoredProviderCredential | undefined {
  return readProviderCredentialStore(path).credentials[provider];
}

export function setStoredProviderCredential(
  credential: StoredProviderCredential,
  path = resolveProviderCredentialStorePath(),
) {
  const store = readProviderCredentialStore(path);
  store.credentials[credential.provider] = credential;
  writeProviderCredentialStore(store, path);
}

export function removeStoredProviderCredential(
  provider: LlmProvider,
  path = resolveProviderCredentialStorePath(),
): boolean {
  const store = readProviderCredentialStore(path);
  const existed = Boolean(store.credentials[provider]);
  delete store.credentials[provider];
  writeProviderCredentialStore(store, path);
  return existed;
}

export function listStoredProviderCredentialSummaries(
  path = resolveProviderCredentialStorePath(),
): ProviderCredentialSummary[] {
  const store = readProviderCredentialStore(path);
  return Object.values(store.credentials)
    .filter((credential): credential is StoredProviderCredential => Boolean(credential))
    .map(summarizeProviderCredential)
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function summarizeProviderCredential(credential: StoredProviderCredential): ProviderCredentialSummary {
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

export function redactProviderCredential(credential: StoredProviderCredential): Record<string, unknown> {
  const summary = summarizeProviderCredential(credential);
  return {
    ...summary,
    key: credential.type === 'api-key' ? redactSecret(credential.key) : undefined,
    token: credential.type === 'bearer' ? redactSecret(credential.token) : undefined,
    accessToken: credential.type === 'oauth' ? redactSecret(credential.accessToken) : undefined,
    refreshToken: credential.type === 'oauth' ? redactSecret(credential.refreshToken) : undefined,
  };
}

export function redactSecret(secret: string): string {
  if (secret.length <= 8) {
    return '<redacted>';
  }

  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function parseProviderCredentialStore(input: unknown): ProviderCredentialStore {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return createEmptyProviderCredentialStore();
  }

  const candidate = input as { version?: unknown; credentials?: unknown };
  if (candidate.version !== 1 || !candidate.credentials || typeof candidate.credentials !== 'object' || Array.isArray(candidate.credentials)) {
    return createEmptyProviderCredentialStore();
  }

  const credentials: ProviderCredentialStore['credentials'] = {};
  for (const [provider, rawCredential] of Object.entries(candidate.credentials)) {
    if (!isLlmProvider(provider)) {
      continue;
    }
    const credential = parseStoredProviderCredential(provider, rawCredential);
    if (credential) {
      credentials[provider] = credential;
    }
  }

  return {
    version: 1,
    credentials,
  };
}

function parseStoredProviderCredential(
  provider: LlmProvider,
  input: unknown,
): StoredProviderCredential | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  if (!isCredentialType(candidate.type)) {
    return undefined;
  }

  const createdAt = readString(candidate.createdAt);
  const updatedAt = readString(candidate.updatedAt);
  if (!createdAt || !updatedAt) {
    return undefined;
  }

  const base = {
    provider,
    createdAt,
    updatedAt,
    label: readString(candidate.label),
  };

  if (candidate.type === 'api-key') {
    const key = readString(candidate.key);
    return key ? { ...base, type: 'api-key', key } : undefined;
  }

  if (candidate.type === 'bearer') {
    const token = readString(candidate.token);
    return token ? { ...base, type: 'bearer', token } : undefined;
  }

  const accessToken = readString(candidate.accessToken);
  const refreshToken = readString(candidate.refreshToken);
  const expiresAt = typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt) ? candidate.expiresAt : undefined;
  if (!accessToken || !refreshToken || !expiresAt) {
    return undefined;
  }

  return {
    ...base,
    type: 'oauth',
    accessToken,
    refreshToken,
    expiresAt,
    accountId: readString(candidate.accountId),
  };
}

function isLlmProvider(value: string): value is LlmProvider {
  return SUPPORTED_PROVIDERS.has(value as LlmProvider);
}

function isCredentialType(value: unknown): value is StoredProviderCredential['type'] {
  return typeof value === 'string' && SUPPORTED_TYPES.has(value as StoredProviderCredential['type']);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

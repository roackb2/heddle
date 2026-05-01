import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getStoredProviderCredential,
  listStoredProviderCredentialSummaries,
  readProviderCredentialStore,
  redactProviderCredential,
  removeStoredProviderCredential,
  resolveProviderCredentialStorePath,
  setStoredProviderCredential,
} from '../../../core/auth/provider-credentials.js';

describe('provider credential store', () => {
  it('resolves the user auth store path under the Heddle base directory', () => {
    expect(resolveProviderCredentialStorePath('/tmp/heddle-auth')).toBe('/tmp/heddle-auth/auth.json');
  });

  it('stores OAuth credentials with private file permissions and redacted display helpers', () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-auth-store-')), 'auth.json');
    const now = '2026-04-27T00:00:00.000Z';

    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      expiresAt: Date.now() + 60_000,
      accountId: 'account-123',
      createdAt: now,
      updatedAt: now,
    }, storePath);

    const stat = statSync(storePath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(getStoredProviderCredential('openai', storePath)).toMatchObject({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-123',
    });
    expect(listStoredProviderCredentialSummaries(storePath)).toEqual([
      expect.objectContaining({
        provider: 'openai',
        type: 'oauth',
        accountId: 'account-123',
        expired: false,
      }),
    ]);

    const credential = getStoredProviderCredential('openai', storePath);
    if (!credential) {
      throw new Error('expected stored credential');
    }
    expect(redactProviderCredential(credential)).toMatchObject({
      accessToken: 'acce…cret',
      refreshToken: 'refr…cret',
    });
  });

  it('ignores malformed credentials instead of surfacing token-shaped junk', () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-auth-store-')), 'auth.json');
    setStoredProviderCredential({
      type: 'bearer',
      provider: 'anthropic',
      token: 'bearer-secret',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, storePath);

    const store = readProviderCredentialStore(storePath);
    expect(store.credentials.anthropic).toMatchObject({ type: 'bearer' });
    expect(removeStoredProviderCredential('anthropic', storePath)).toBe(true);
    expect(removeStoredProviderCredential('anthropic', storePath)).toBe(false);
    expect(listStoredProviderCredentialSummaries(storePath)).toEqual([]);
  });
});

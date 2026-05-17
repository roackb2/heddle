import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderCredentialRepository } from '../../../core/auth/index.js';

describe('provider credential store', () => {
  it('resolves the user auth store path under the Heddle base directory', () => {
    expect(ProviderCredentialRepository.resolveStorePath('/tmp/heddle-auth')).toBe('/tmp/heddle-auth/auth.json');
  });

  it('stores OAuth credentials with private file permissions and redacted display helpers', () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-auth-store-')), 'auth.json');
    const now = '2026-04-27T00:00:00.000Z';

    const repository = new ProviderCredentialRepository({ storePath });
    repository.set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      expiresAt: Date.now() + 60_000,
      accountId: 'account-123',
      createdAt: now,
      updatedAt: now,
    });

    const stat = statSync(storePath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(repository.get('openai')).toMatchObject({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-123',
    });
    expect(repository.listSummaries()).toEqual([
      expect.objectContaining({
        provider: 'openai',
        type: 'oauth',
        accountId: 'account-123',
        expired: false,
      }),
    ]);

    const credential = repository.get('openai');
    if (!credential) {
      throw new Error('expected stored credential');
    }
    expect(ProviderCredentialRepository.redact(credential)).toMatchObject({
      accessToken: 'acce…cret',
      refreshToken: 'refr…cret',
    });
  });

  it('ignores malformed credentials instead of surfacing token-shaped junk', () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-auth-store-')), 'auth.json');
    const repository = new ProviderCredentialRepository({ storePath });
    repository.set({
      type: 'bearer',
      provider: 'anthropic',
      token: 'bearer-secret',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    });

    const store = repository.read();
    expect(store.credentials.anthropic).toMatchObject({ type: 'bearer' });
    expect(repository.remove('anthropic')).toBe(true);
    expect(repository.remove('anthropic')).toBe(false);
    expect(repository.listSummaries()).toEqual([]);
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAuthCli } from '../../cli/auth.js';
import { setStoredProviderCredential } from '../../core/auth/provider-credentials.js';

describe('runAuthCli', () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;

  afterEach(() => {
    process.stdout.write = originalWrite;
    writes.length = 0;
    vi.restoreAllMocks();
  });

  function captureStdout() {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  }

  it('prints an empty auth status', async () => {
    captureStdout();
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-auth-cli-')), 'auth.json');

    await runAuthCli('status', undefined, { storePath });

    expect(writes.join('')).toContain(`Auth store: ${storePath}`);
    expect(writes.join('')).toContain('Stored credentials: none');
  });

  it('prints stored credential summaries without secrets and removes provider credentials', async () => {
    captureStdout();
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-auth-cli-')), 'auth.json');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: Date.now() + 60_000,
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, storePath);

    await runAuthCli('status', undefined, { storePath });
    await runAuthCli('logout', 'openai', { storePath });

    const output = writes.join('');
    expect(output).toContain('- openai: type=oauth account=account-123');
    expect(output).not.toContain('access-secret');
    expect(output).not.toContain('refresh-secret');
    expect(output).toContain('Removed stored openai credential.');
  });
});

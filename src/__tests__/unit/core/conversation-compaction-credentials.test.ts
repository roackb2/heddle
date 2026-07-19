import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { LlmAdapterService, type LlmAdapter } from '@/core/llm/index.js';

describe('conversation compaction credentials', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keeps compaction on the supplied BYOK key instead of a host key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'host-openai-key');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const llm = summaryLlm('BYOK rolling summary');
    const create = vi.spyOn(LlmAdapterService, 'create').mockReturnValue(llm);
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-compaction-byok-'));

    const compacted = await ConversationCompactionService.compact({
      history: history(),
      runtime: { model: 'gpt-5.4', stateRoot },
      session: { id: 'session-1' },
      force: true,
      summarizer: {
        apiKey: 'user-byok-key',
        credentialSource: { type: 'explicit-api-key' },
      },
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.1-codex-mini',
      credentials: {
        apiKey: 'user-byok-key',
        credentialStorePath: undefined,
      },
    }));
    expect(compacted.archive.archives).toHaveLength(1);
    expect(compacted.context.compaction?.status).toBe('idle');
  });

  it('keeps compaction on the selected OAuth store', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const root = await mkdtemp(join(tmpdir(), 'heddle-compaction-oauth-'));
    const credentialStorePath = join(root, 'auth.json');
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const expiresAt = now + 60 * 60 * 1_000;
    new ProviderCredentialRepository({ storePath: credentialStorePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt,
      accountId: 'account-123',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const llm = summaryLlm('OAuth rolling summary');
    const create = vi.spyOn(LlmAdapterService, 'create').mockReturnValue(llm);

    const compacted = await ConversationCompactionService.compact({
      history: history(),
      runtime: { model: 'gpt-5.4', stateRoot: join(root, '.heddle') },
      session: { id: 'session-1' },
      force: true,
      summarizer: {
        credentialStorePath,
        credentialSource: {
          type: 'oauth',
          provider: 'openai',
          accountId: 'account-123',
          expiresAt,
        },
      },
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
      credentials: {
        apiKey: undefined,
        credentialStorePath,
      },
    }));
    expect(compacted.archive.archives).toHaveLength(1);
  });
});

function history() {
  return [
    { role: 'user' as const, content: 'Remember the durable marker.' },
    { role: 'assistant' as const, content: 'Marker stored.' },
    { role: 'user' as const, content: 'Continue the conversation.' },
    { role: 'assistant' as const, content: 'Continuing.' },
  ];
}

function summaryLlm(content: string): LlmAdapter {
  return {
    chat: vi.fn(async () => ({ content })),
  };
}

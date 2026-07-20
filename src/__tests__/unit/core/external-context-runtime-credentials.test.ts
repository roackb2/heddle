import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_CODEX_RESPONSES_ENDPOINT } from '../../../core/auth/openai-oauth.js';
import { createWebSearchTool } from '../../../core/tools/toolkits/external-context/web-search.js';

describe('external-context runtime credentials', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the request-scoped OpenAI access token for web search', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
      });
      return new Response([
        'data: {"type":"response.output_text.done","text":"Runtime credential search result."}',
        '',
      ].join('\n'));
    }) as typeof fetch);

    const credential = {
      type: 'oauth-access-token',
      provider: 'openai',
      accessToken: 'request-access-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
    } as const;
    const tool = createWebSearchTool({
      model: 'gpt-5.4',
      credential,
      providerCredentialSource: {
        type: 'oauth-access-token',
        provider: 'openai',
        expiresAt: credential.expiresAt,
        accountId: credential.accountId,
      },
    });

    await expect(tool.execute({ query: 'Heddle runtime credentials' })).resolves.toMatchObject({
      ok: true,
      output: {
        provider: 'openai',
        model: 'gpt-5.4',
        summary: 'Runtime credential search result.',
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(OPENAI_CODEX_RESPONSES_ENDPOINT);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer request-access-token');
    expect(requests[0]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPENAI_AUTH_ISSUER,
  OPENAI_CODEX_RESPONSES_ENDPOINT,
  OPENAI_CODEX_CLIENT_ID,
  buildOpenAiAuthorizeUrl,
  createOpenAiOAuthCredential,
  exchangeOpenAiOAuthCode,
  extractOpenAiAccountId,
  generatePkceCodes,
  refreshOpenAiOAuthToken,
  type OpenAiOAuthTokenResponse,
} from '../../core/auth/openai-oauth.js';
import { createOpenAiAdapter, createOpenAiOAuthFetch } from '../../core/llm/openai.js';

describe('OpenAI OAuth helpers', () => {
  it('generates PKCE verifier and challenge values', () => {
    const pkce = generatePkceCodes();

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).toHaveLength(43);
  });

  it('builds the Codex OAuth authorize URL', () => {
    const url = new URL(buildOpenAiAuthorizeUrl({
      redirectUri: 'http://localhost:1455/auth/callback',
      pkce: { verifier: 'verifier', challenge: 'challenge' },
      state: 'state',
    }));

    expect(`${url.origin}${url.pathname}`).toBe(`${OPENAI_AUTH_ISSUER}/oauth/authorize`);
    expect(url.searchParams.get('client_id')).toBe(OPENAI_CODEX_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
    expect(url.searchParams.get('originator')).toBe('heddle');
  });

  it('extracts account id from id token claims', () => {
    const tokens: OpenAiOAuthTokenResponse = {
      id_token: createJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-nested' } }),
      access_token: createJwt({ chatgpt_account_id: 'account-access' }),
      refresh_token: 'refresh',
    };

    expect(extractOpenAiAccountId(tokens)).toBe('account-nested');
    expect(createOpenAiOAuthCredential(tokens, Date.parse('2026-04-27T00:00:00.000Z'))).toMatchObject({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-nested',
      expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
      label: 'ChatGPT/Codex OAuth',
    });
  });

  it('exchanges authorization code and refresh tokens through OpenAI auth', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: String(init?.body),
      });
      return Response.json({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
      });
    }) as typeof fetch;

    await exchangeOpenAiOAuthCode({
      code: 'code',
      redirectUri: 'http://localhost:1455/auth/callback',
      codeVerifier: 'verifier',
      fetchImpl,
    });
    await refreshOpenAiOAuthToken({
      refreshToken: 'refresh-token',
      fetchImpl,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(`${OPENAI_AUTH_ISSUER}/oauth/token`);
    expect(new URLSearchParams(requests[0]?.body).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(requests[0]?.body).get('client_id')).toBe(OPENAI_CODEX_CLIENT_ID);
    expect(new URLSearchParams(requests[0]?.body).get('code_verifier')).toBe('verifier');
    expect(new URLSearchParams(requests[1]?.body).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(requests[1]?.body).get('refresh_token')).toBe('refresh-token');
  });

  it('rewrites Responses calls to the Codex endpoint with refreshed OAuth headers', async () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-oauth-fetch-')), 'auth.json');
    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ''),
      });
      if (String(url).endsWith('/oauth/token')) {
        return Response.json({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        });
      }
      return new Response('ok');
    }) as typeof fetch;
    const oauthFetch = createOpenAiOAuthFetch({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, {
      storePath,
      fetchImpl,
    });

    await oauthFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer placeholder' },
      body: JSON.stringify({ model: 'gpt-5.1-codex' }),
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(`${OPENAI_AUTH_ISSUER}/oauth/token`);
    expect(requests[1]?.url).toBe(OPENAI_CODEX_RESPONSES_ENDPOINT);
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer new-access-token');
    expect(requests[1]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
  });

  it('fails clearly for account sign-in with a model outside the known Codex set', async () => {
    const adapter = createOpenAiAdapter({
      model: 'o3',
      credential: {
        type: 'oauth',
        provider: 'openai',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 120_000,
        accountId: 'account-123',
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
      },
    });

    await expect(adapter.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow(
      'OpenAI account sign-in is not enabled for model o3.',
    );
  });

  it('uses the Codex-compatible Responses payload shape for account sign-in models', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const adapter = createOpenAiAdapter({
      model: 'gpt-5.4',
      credential: {
        type: 'oauth',
        provider: 'openai',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 120_000,
        accountId: 'account-123',
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
      },
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), body: String((init as RequestInit | undefined)?.body ?? '') });
        return new Response('bad request', { status: 400 });
      }) as typeof fetch,
    });

    await expect(adapter.chat([
      { role: 'system', content: 'You are Heddle. Reply with OK only.' },
      { role: 'user', content: 'hello' },
    ], [])).rejects.toThrow();

    expect(requests[0]?.url).toBe(OPENAI_CODEX_RESPONSES_ENDPOINT);
    const body = JSON.parse(requests[0]?.body ?? '{}') as {
      model?: string;
      store?: boolean;
      reasoning?: { summary?: string };
      instructions?: string;
      input?: Array<{ type?: string; role?: string; content?: string }>;
    };
    expect(body.model).toBe('gpt-5.4');
    expect(body.store).toBe(false);
    expect(body.reasoning?.summary).toBe('auto');
    expect(body.instructions).toBe('You are Heddle. Reply with OK only.');
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: 'hello' },
    ]);
  });

  it('reconstructs tool calls from streamed Codex OAuth events when final response output is empty', async () => {
    const adapter = createOpenAiAdapter({
      model: 'gpt-5.4',
      credential: {
        type: 'oauth',
        provider: 'openai',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 120_000,
        accountId: 'account-123',
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
      },
      fetchImpl: (async () => {
        const body = [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"in_progress","model":"gpt-5.4","output":[]}}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"fc_item_1","type":"function_call","status":"in_progress","arguments":"","call_id":"call_123","name":"list_files"},"output_index":0,"sequence_number":2}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","delta":"{\\"","item_id":"fc_item_1","output_index":0,"sequence_number":3}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","delta":"path\\":\\".\\"}","item_id":"fc_item_1","output_index":0,"sequence_number":4}',
          '',
          'event: response.function_call_arguments.done',
          'data: {"type":"response.function_call_arguments.done","arguments":"{\\"path\\":\\".\\"}","item_id":"fc_item_1","output_index":0,"sequence_number":5}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"id":"fc_item_1","type":"function_call","status":"completed","arguments":"{\\"path\\":\\".\\"}","call_id":"call_123","name":"list_files"},"output_index":0,"sequence_number":6}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"completed","completed_at":1777301835,"model":"gpt-5.4","output":[],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":15}}}',
          '',
        ].join('\n');

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }) as typeof fetch,
    });

    const result = await adapter.chat([
      { role: 'system', content: 'Use tools immediately when needed.' },
      { role: 'user', content: 'List files in the current directory.' },
    ], [
      {
        name: 'list_files',
        description: 'Lists files in a directory',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        async execute() {
          return { ok: true, output: '' };
        },
      },
    ]);

    expect(result.toolCalls).toEqual([
      {
        id: 'call_123',
        tool: 'list_files',
        input: { path: '.' },
      },
    ]);
  });
});

function createJwt(payload: unknown): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

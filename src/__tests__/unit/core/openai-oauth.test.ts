import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPENAI_AUTH_ISSUER,
  OPENAI_CODEX_RESPONSES_ENDPOINT,
  OPENAI_CODEX_CLIENT_ID,
  OpenAiOAuthService,
} from '../../../core/auth/openai-oauth.js';
import type { OpenAiOAuthTokenResponse } from '../../../core/auth/index.js';
import { OpenAiAdapter, OpenAiOAuthFetchService } from '../../../core/llm/adapters/openai/index.js';
import type { ReasoningEffort } from '../../../core/llm/types.js';

describe('OpenAI OAuth helpers', () => {
  it('generates PKCE verifier and challenge values', () => {
    const pkce = OpenAiOAuthService.generatePkceCodes();

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).toHaveLength(43);
  });

  it('builds the Codex OAuth authorize URL', () => {
    const url = new URL(OpenAiOAuthService.buildAuthorizeUrl({
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

  it('opens OAuth URLs on Windows without routing query separators through cmd.exe', () => {
    const authorizeUrl = 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback';
    const command = OpenAiOAuthService.buildOpenUrlCommand(authorizeUrl, 'win32');
    const encodedCommand = command.args.at(-1);

    expect(command.command).toBe('powershell.exe');
    expect(command.args).toContain('-EncodedCommand');
    expect(encodedCommand).toBeDefined();
    expect(Buffer.from(encodedCommand!, 'base64').toString('utf16le')).toBe(`Start-Process -FilePath '${authorizeUrl}'`);
    expect(command.args.join(' ')).not.toContain('cmd /c start');
  });

  it('extracts account id from id token claims', () => {
    const tokens: OpenAiOAuthTokenResponse = {
      id_token: createJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-nested' } }),
      access_token: createJwt({ chatgpt_account_id: 'account-access' }),
      refresh_token: 'refresh',
    };

    expect(OpenAiOAuthService.extractAccountId(tokens)).toBe('account-nested');
    expect(OpenAiOAuthService.createCredential(tokens, Date.parse('2026-04-27T00:00:00.000Z'))).toMatchObject({
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

    await OpenAiOAuthService.exchangeCode({
      code: 'code',
      redirectUri: 'http://localhost:1455/auth/callback',
      codeVerifier: 'verifier',
      fetchImpl,
    });
    await OpenAiOAuthService.refreshToken({
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

  it('completes browser login after callback token exchange succeeds', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    let callbackResponse: Promise<Response> | undefined;
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

    const credential = await OpenAiOAuthService.runBrowserLogin({
      port: 0,
      openBrowser: false,
      fetchImpl,
      onAuthorizeUrl: (authorizeUrl) => {
        const url = new URL(authorizeUrl);
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        if (!redirectUri || !state) {
          throw new Error('OAuth authorize URL did not include callback metadata');
        }
        callbackResponse = fetch(`${redirectUri}?code=callback-code&state=${state}`);
      },
    });

    await expect(callbackResponse).resolves.toMatchObject({ status: 200 });
    expect(credential).toMatchObject({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access',
      refreshToken: 'refresh',
      label: 'ChatGPT/Codex OAuth',
    });
    expect(requests).toHaveLength(1);
    expect(new URLSearchParams(requests[0]?.body).get('code')).toBe('callback-code');
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
    const oauthFetch = OpenAiOAuthFetchService.create({
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
    expect(requests[1]?.headers.get('originator')).toBe('heddle');
    expect(requests[1]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
  });

  it('routes a request-scoped access token without refreshing or persisting it', async () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-runtime-oauth-fetch-')), 'auth.json');
    const requests: Array<{ url: string; headers: Headers }> = [];
    const oauthFetch = OpenAiOAuthFetchService.create({
      type: 'oauth-access-token',
      provider: 'openai',
      accessToken: 'request-access-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
    }, {
      storePath,
      fetchImpl: (async (url, init) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
        });
        return new Response('ok');
      }) as typeof fetch,
    });

    await oauthFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer placeholder' },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(OPENAI_CODEX_RESPONSES_ENDPOINT);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer request-access-token');
    expect(requests[0]?.headers.get('originator')).toBe('heddle');
    expect(requests[0]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
    expect(existsSync(storePath)).toBe(false);
  });

  it('rejects an expired request-scoped token before any provider request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const oauthFetch = OpenAiOAuthFetchService.create({
      type: 'oauth-access-token',
      provider: 'openai',
      accessToken: 'expired-access-token',
      expiresAt: Date.now() - 1_000,
    }, { fetchImpl });

    await expect(oauthFetch('https://api.openai.com/v1/responses')).rejects.toMatchObject({
      code: 'oauth_access_token_expired',
      status: 401,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails clearly for account sign-in with a model outside the known Codex set', async () => {
    const adapter = createOpenAiTestAdapter({
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

  it('fails clearly before routing gpt-5.1-codex-mini through account sign-in', async () => {
    const adapter = createOpenAiTestAdapter({
      model: 'gpt-5.1-codex-mini',
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
        throw new Error('fetch should not be called');
      }) as typeof fetch,
    });

    await expect(adapter.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow(
      'OpenAI account sign-in is not enabled for model gpt-5.1-codex-mini.',
    );
  });

  it('includes the default reasoning effort for supported reasoning models', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const adapter = createOpenAiTestAdapter({
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

    await expect(adapter.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow();
    const body = JSON.parse(requests[0]?.body ?? '{}') as { reasoning?: { effort?: string } };
    expect(body.reasoning?.effort).toBe('medium');
  });

  it('uses the Codex-compatible Responses payload shape for account sign-in models', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const adapter = createOpenAiTestAdapter({
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
      include?: string[];
      instructions?: string;
      input?: Array<{ type?: string; role?: string; content?: string }>;
    };
    expect(body.model).toBe('gpt-5.4');
    expect(body.store).toBe(false);
    expect(body.reasoning?.summary).toBe('detailed');
    expect(body.include).toEqual(['reasoning.encrypted_content']);
    expect(body.instructions).toContain('You are Heddle. Reply with OK only.');
    expect(body.instructions).toContain('brief, concrete commentary messages');
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: 'hello' },
    ]);
  });

  it('includes explicit reasoning effort when configured', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const adapter = createOpenAiTestAdapter({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
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

    await expect(adapter.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow();
    const body = JSON.parse(requests[0]?.body ?? '{}') as { reasoning?: { effort?: string } };
    expect(body.reasoning?.effort).toBe('medium');
  });

  it('includes ultrahigh reasoning effort for models that support it', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const adapter = createOpenAiTestAdapter({
      model: 'gpt-5.5',
      reasoningEffort: 'ultrahigh',
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

    await expect(adapter.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow();
    const body = JSON.parse(requests[0]?.body ?? '{}') as { reasoning?: { effort?: string } };
    expect(body.reasoning?.effort).toBe('xhigh');
  });

  it('reconstructs tool calls from streamed Codex OAuth events when final response output is empty', async () => {
    const adapter = createOpenAiTestAdapter({
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

  it('streams OpenAI reasoning summary text events to the LLM stream callback', async () => {
    const adapter = createOpenAiTestAdapter({
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
          'data: {"type":"response.output_item.added","item":{"id":"rs_1","type":"reasoning","status":"in_progress","summary":[{"type":"summary_text","text":""}]},"output_index":0,"sequence_number":2}',
          '',
          'event: response.reasoning_summary_text.delta',
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Inspecting ","item_id":"rs_1","output_index":0,"summary_index":0,"sequence_number":3}',
          '',
          'event: response.reasoning_summary_text.delta',
          'data: {"type":"response.reasoning_summary_text.delta","delta":"the repo.","item_id":"rs_1","output_index":0,"summary_index":0,"sequence_number":4}',
          '',
          'event: response.reasoning_summary_text.done',
          'data: {"type":"response.reasoning_summary_text.done","text":"Inspecting the repo.","item_id":"rs_1","output_index":0,"summary_index":0,"sequence_number":5}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","role":"assistant","content":[{"type":"output_text","text":"","annotations":[]}]},"output_index":1,"sequence_number":6}',
          '',
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","text":"Done.","content_index":0,"item_id":"msg_1","output_index":1,"sequence_number":7}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"completed","completed_at":1777301835,"model":"gpt-5.4","output_text":"Done.","output":[{"id":"rs_1","type":"reasoning","status":"completed","summary":[{"type":"summary_text","text":"Inspecting the repo."}]},{"id":"msg_1","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Done.","annotations":[]}]}],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":1},"total_tokens":15}}}',
          '',
        ].join('\n');

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }) as typeof fetch,
    });
    const streamEvents: unknown[] = [];

    const result = await adapter.chat([{ role: 'user', content: 'hello' }], [], undefined, (event) => {
      streamEvents.push(event);
    });

    expect(streamEvents).toEqual([
      { type: 'reasoning_summary.delta', delta: 'Inspecting ' },
      { type: 'reasoning_summary.delta', delta: 'the repo.' },
      { type: 'reasoning_summary.done', text: 'Inspecting the repo.' },
      { type: 'content.done', content: 'Done.' },
    ]);
    expect(result.content).toBe('Done.');
  });

  it('separates assistant commentary from the final-answer stream by message phase', async () => {
    const adapter = createOpenAiTestAdapter({
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
          'data: {"type":"response.output_item.added","item":{"id":"msg_commentary","type":"message","status":"in_progress","role":"assistant","content":[{"type":"output_text","text":"","annotations":[]}],"phase":"commentary"},"output_index":0,"sequence_number":2}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"I’m checking ","content_index":0,"item_id":"msg_commentary","output_index":0,"sequence_number":3}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"the repository now.","content_index":0,"item_id":"msg_commentary","output_index":0,"sequence_number":4}',
          '',
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","text":"I’m checking the repository now.","content_index":0,"item_id":"msg_commentary","output_index":0,"sequence_number":5}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"msg_final","type":"message","status":"in_progress","role":"assistant","content":[{"type":"output_text","text":"","annotations":[]}],"phase":"final_answer"},"output_index":1,"sequence_number":6}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"Done.","content_index":0,"item_id":"msg_final","output_index":1,"sequence_number":7}',
          '',
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","text":"Done.","content_index":0,"item_id":"msg_final","output_index":1,"sequence_number":8}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"completed","completed_at":1777301835,"model":"gpt-5.4","output_text":"I’m checking the repository now.\nDone.","output":[{"id":"msg_commentary","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"I’m checking the repository now.","annotations":[]}],"phase":"commentary"},{"id":"msg_final","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Done.","annotations":[]}],"phase":"final_answer"}],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":10,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":20}}}',
          '',
        ].join('\n');

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }) as typeof fetch,
    });
    const streamEvents: unknown[] = [];

    const result = await adapter.chat([{ role: 'user', content: 'Inspect the repo.' }], [], undefined, (event) => {
      streamEvents.push(event);
    });

    expect(streamEvents).toEqual([
      { type: 'commentary.delta', messageId: 'msg_commentary', delta: 'I’m checking ' },
      { type: 'commentary.delta', messageId: 'msg_commentary', delta: 'the repository now.' },
      { type: 'commentary.done', messageId: 'msg_commentary', text: 'I’m checking the repository now.' },
      { type: 'content.delta', delta: 'Done.' },
      { type: 'content.done', content: 'Done.' },
    ]);
    expect(result.content).toBe('Done.');
  });

  it('uses the captured completed response when stream iteration fails after completion', async () => {
    const adapter = createOpenAiTestAdapter({
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
          'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","role":"assistant","content":[{"type":"output_text","text":"","annotations":[]}]},"output_index":0,"sequence_number":2}',
          '',
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","text":"Done.","content_index":0,"item_id":"msg_1","output_index":0,"sequence_number":3}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"completed","completed_at":1777301835,"model":"gpt-5.4","output_text":"Done.","output":[{"id":"msg_1","type":"message","status":"completed","role":"assistant"}],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":15}}}',
          '',
        ].join('\n');

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }) as typeof fetch,
    });

    const result = await adapter.chat([{ role: 'user', content: 'hello' }], []);

    expect(result.content).toBe('Done.');
  });
});

function createJwt(payload: unknown): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function createOpenAiTestAdapter(options: {
  model: string;
  credential?: Parameters<typeof OpenAiOAuthFetchService.create>[0];
  fetchImpl?: typeof fetch;
  reasoningEffort?: ReasoningEffort;
}): OpenAiAdapter {
  return new OpenAiAdapter({
    model: options.model,
    credentials: { credential: options.credential },
    runtime: {
      fetchImpl: options.fetchImpl,
      reasoningEffort: options.reasoningEffort,
    },
  });
}

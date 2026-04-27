import { describe, expect, it } from 'vitest';
import {
  OPENAI_AUTH_ISSUER,
  OPENAI_CODEX_CLIENT_ID,
  buildOpenAiAuthorizeUrl,
  createOpenAiOAuthCredential,
  exchangeOpenAiOAuthCode,
  extractOpenAiAccountId,
  generatePkceCodes,
  refreshOpenAiOAuthToken,
  type OpenAiOAuthTokenResponse,
} from '../../core/auth/openai-oauth.js';

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
});

function createJwt(payload: unknown): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

import { describe, expect, it, vi } from 'vitest';
import {
  OpenAiDeviceCodeAuthService,
} from '../../../core/auth/index.js';
import type { OpenAiDeviceCodeChallenge } from '../../../core/auth/index.js';
import {
  OPENAI_AUTH_ISSUER,
  OPENAI_CODEX_CLIENT_ID,
} from '../../../core/auth/openai-oauth.js';

describe('OpenAI device-code auth', () => {
  it('requests and validates a provider device-code challenge', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      device_auth_id: 'device-auth-123',
      user_code: 'ABCD-1234',
      interval: '5',
      expires_at: expiresAt,
    }));

    await expect(OpenAiDeviceCodeAuthService.requestCode({ fetchImpl })).resolves.toEqual({
      deviceAuthId: 'device-auth-123',
      userCode: 'ABCD-1234',
      verificationUrl: `${OPENAI_AUTH_ISSUER}/codex/device`,
      intervalMs: 5_000,
      expiresAt: Date.parse(expiresAt),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`);
    expect(JSON.parse(String(init?.body))).toEqual({ client_id: OPENAI_CODEX_CLIENT_ID });
  });

  it('reports a pending device-code authorization without exchanging tokens', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));

    await expect(OpenAiDeviceCodeAuthService.poll(challenge(), { fetchImpl })).resolves.toEqual({
      status: 'pending',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reports an expired challenge without contacting OpenAI', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(OpenAiDeviceCodeAuthService.poll({
      ...challenge(),
      expiresAt: Date.now() - 1,
    }, { fetchImpl })).resolves.toEqual({ status: 'expired' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed round-tripped challenges before contacting OpenAI', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(OpenAiDeviceCodeAuthService.poll({
      ...challenge(),
      deviceAuthId: ' ',
    }, { fetchImpl })).rejects.toThrow('missing its authorization identifiers');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exchanges an approved device code for a non-persistable runtime credential', async () => {
    const accessToken = createJwt({ chatgpt_account_id: 'account-123' });
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      requests.push({ url: String(url), body: String(init?.body ?? '') });
      if (String(url).endsWith('/deviceauth/token')) {
        return Response.json({
          authorization_code: 'authorization-code',
          code_challenge: 'code-challenge',
          code_verifier: 'code-verifier',
        });
      }
      return Response.json({
        access_token: accessToken,
        refresh_token: 'discarded-refresh-token',
        expires_in: 120,
      });
    });
    const before = Date.now();

    const result = await OpenAiDeviceCodeAuthService.poll(challenge(), { fetchImpl });

    expect(result).toMatchObject({
      status: 'authorized',
      credential: {
        type: 'oauth-access-token',
        provider: 'openai',
        accessToken,
        accountId: 'account-123',
      },
    });
    if (result.status !== 'authorized') {
      throw new Error('Expected an authorized device-code result.');
    }
    expect(result.credential.expiresAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(result.credential).not.toHaveProperty('refreshToken');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`);
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({
      device_auth_id: 'device-auth-123',
      user_code: 'ABCD-1234',
    });
    expect(requests[1]?.url).toBe(`${OPENAI_AUTH_ISSUER}/oauth/token`);
    const exchange = new URLSearchParams(requests[1]?.body);
    expect(exchange.get('code')).toBe('authorization-code');
    expect(exchange.get('code_verifier')).toBe('code-verifier');
    expect(exchange.get('redirect_uri')).toBe(`${OPENAI_AUTH_ISSUER}/deviceauth/callback`);
  });
});

function challenge(): OpenAiDeviceCodeChallenge {
  return {
    deviceAuthId: 'device-auth-123',
    userCode: 'ABCD-1234',
    verificationUrl: `${OPENAI_AUTH_ISSUER}/codex/device`,
    intervalMs: 5_000,
    expiresAt: Date.now() + 15 * 60_000,
  };
}

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

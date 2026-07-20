import dayjs from 'dayjs';
import { z } from 'zod';
import {
  OPENAI_AUTH_ISSUER,
  OPENAI_CODEX_CLIENT_ID,
  OpenAiOAuthService,
} from './openai-oauth.js';
import type {
  OpenAiDeviceCodeChallenge,
  OpenAiDeviceCodePollOptions,
  OpenAiDeviceCodePollResult,
  OpenAiDeviceCodeRequestOptions,
} from './types.js';

const OPENAI_DEVICE_AUTH_API_BASE_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth`;
const OPENAI_DEVICE_AUTH_CALLBACK_URI = `${OPENAI_AUTH_ISSUER}/deviceauth/callback`;
const OPENAI_DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`;

const deviceCodeResponseSchema = z.object({
  device_auth_id: z.string().trim().min(1),
  expires_at: z.string().trim().min(1),
  interval: z.coerce.number().int().positive(),
  user_code: z.string().trim().min(1).optional(),
  usercode: z.string().trim().min(1).optional(),
}).refine((value) => Boolean(value.user_code ?? value.usercode), {
  message: 'Device-code response did not include a user code.',
});

const deviceAuthorizationResponseSchema = z.object({
  authorization_code: z.string().trim().min(1),
  code_challenge: z.string().trim().min(1),
  code_verifier: z.string().trim().min(1),
});

/**
 * Owns the stateless OpenAI Codex device-code handshake for hosted adopters.
 * It returns an access-token-only runtime credential and never persists or
 * exposes the refresh token received during the final exchange.
 */
export class OpenAiDeviceCodeAuthService {
  static async requestCode(
    options: OpenAiDeviceCodeRequestOptions = {},
  ): Promise<OpenAiDeviceCodeChallenge> {
    const response = await (options.fetchImpl ?? fetch)(`${OPENAI_DEVICE_AUTH_API_BASE_URL}/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
      signal: options.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('OpenAI device-code login is not enabled for this Codex client.');
      }
      throw new Error(`OpenAI device-code request failed: ${response.status}`);
    }

    const parsed = deviceCodeResponseSchema.safeParse(
      await OpenAiDeviceCodeAuthService.readJson(response, 'device-code'),
    );
    if (!parsed.success) {
      throw new Error('OpenAI device-code response was invalid.');
    }

    const expiresAt = dayjs(parsed.data.expires_at);
    if (!expiresAt.isValid() || !expiresAt.isAfter(dayjs())) {
      throw new Error('OpenAI device-code response included an invalid expiry.');
    }

    return {
      deviceAuthId: parsed.data.device_auth_id,
      userCode: parsed.data.user_code ?? parsed.data.usercode!,
      verificationUrl: OPENAI_DEVICE_VERIFICATION_URL,
      intervalMs: parsed.data.interval * 1000,
      expiresAt: expiresAt.valueOf(),
    };
  }

  static async poll(
    challenge: OpenAiDeviceCodeChallenge,
    options: OpenAiDeviceCodePollOptions = {},
  ): Promise<OpenAiDeviceCodePollResult> {
    OpenAiDeviceCodeAuthService.assertChallenge(challenge);
    if (!dayjs(challenge.expiresAt).isAfter(dayjs())) {
      return { status: 'expired' };
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${OPENAI_DEVICE_AUTH_API_BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: challenge.deviceAuthId.trim(),
        user_code: challenge.userCode.trim(),
      }),
      signal: options.signal,
    });

    if (response.status === 403 || response.status === 404) {
      return { status: 'pending' };
    }
    if (!response.ok) {
      throw new Error(`OpenAI device-code poll failed: ${response.status}`);
    }

    const parsed = deviceAuthorizationResponseSchema.safeParse(
      await OpenAiDeviceCodeAuthService.readJson(response, 'device-code authorization'),
    );
    if (!parsed.success) {
      throw new Error('OpenAI device-code authorization response was invalid.');
    }

    const tokens = await OpenAiOAuthService.exchangeCode({
      code: parsed.data.authorization_code,
      redirectUri: OPENAI_DEVICE_AUTH_CALLBACK_URI,
      codeVerifier: parsed.data.code_verifier,
      fetchImpl,
      signal: options.signal,
    });

    return {
      status: 'authorized',
      credential: OpenAiOAuthService.createRuntimeCredential(tokens),
    };
  }

  private static async readJson(response: Response, label: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error(`OpenAI ${label} response was not valid JSON.`);
    }
  }

  private static assertChallenge(challenge: OpenAiDeviceCodeChallenge): void {
    if (!challenge.deviceAuthId.trim() || !challenge.userCode.trim()) {
      throw new Error('OpenAI device-code challenge is missing its authorization identifiers.');
    }
    if (!Number.isFinite(challenge.expiresAt)) {
      throw new Error('OpenAI device-code challenge expiry must be a finite Unix timestamp in milliseconds.');
    }
  }
}

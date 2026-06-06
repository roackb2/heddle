import get from 'lodash/get.js';
import includes from 'lodash/includes.js';
import isNumber from 'lodash/isNumber.js';
import isString from 'lodash/isString.js';
import type { LlmResponse } from '@/core/llm/types.js';

export type AgentModelTurnRetryReason = 'transport_error' | 'empty_response';

export type AgentModelTurnRetryDecision = {
  retryable: boolean;
  reason?: AgentModelTurnRetryReason;
  maxAttempts: number;
  message: string;
};

export type AgentModelTurnRetryFailure =
  | { kind: 'error'; error: unknown }
  | { kind: 'response'; response: LlmResponse };

const TRANSPORT_RETRY_ATTEMPTS = 5;
const EMPTY_RESPONSE_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  'fetch failed',
  'network',
  'socket hang up',
  'connection reset',
  'connection refused',
  'connection terminated',
  'connection closed',
  'stream terminated',
  'terminated',
  'timeout',
  'timed out',
  'disconnect',
  'disconnected',
  'temporarily unavailable',
  'rate limit',
];

/**
 * Owns retry classification and delay policy for a single model turn.
 *
 * The agent loop retries only the provider/model request. It never replays tool
 * calls or complete runs, because those effects belong to later loop phases.
 */
export class AgentModelTurnRetryService {
  static resolve(failure: AgentModelTurnRetryFailure): AgentModelTurnRetryDecision {
    if (failure.kind === 'response') {
      return AgentModelTurnRetryService.resolveResponse(failure.response);
    }

    return AgentModelTurnRetryService.resolveError(failure.error);
  }

  static nextDelayMs(attempt: number): number {
    return Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), RETRY_MAX_DELAY_MS);
  }

  private static resolveResponse(response: LlmResponse): AgentModelTurnRetryDecision {
    if (response.content || (response.toolCalls?.length ?? 0) > 0) {
      return { retryable: false, maxAttempts: 1, message: 'Model response is usable.' };
    }

    return {
      retryable: true,
      reason: 'empty_response',
      maxAttempts: EMPTY_RESPONSE_RETRY_ATTEMPTS,
      message: 'Model returned an empty response',
    };
  }

  private static resolveError(error: unknown): AgentModelTurnRetryDecision {
    const message = AgentModelTurnRetryService.formatErrorMessage(error);
    const status = AgentModelTurnRetryService.readStatusCode(error);

    if (status !== undefined && NON_RETRYABLE_STATUS_CODES.has(status)) {
      return { retryable: false, maxAttempts: 1, message };
    }

    if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) {
      return {
        retryable: true,
        reason: 'transport_error',
        maxAttempts: TRANSPORT_RETRY_ATTEMPTS,
        message,
      };
    }

    if (AgentModelTurnRetryService.hasRetryableErrorCode(error) || AgentModelTurnRetryService.hasRetryableMessage(message)) {
      return {
        retryable: true,
        reason: 'transport_error',
        maxAttempts: TRANSPORT_RETRY_ATTEMPTS,
        message,
      };
    }

    return { retryable: false, maxAttempts: 1, message };
  }

  private static readStatusCode(error: unknown): number | undefined {
    const status = get(error, 'status') ?? get(error, 'statusCode') ?? get(error, 'response.status');
    if (isNumber(status)) {
      return status;
    }

    if (isString(status)) {
      const parsed = Number.parseInt(status, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private static hasRetryableErrorCode(error: unknown): boolean {
    const code = get(error, 'code') ?? get(error, 'cause.code');
    return isString(code) && RETRYABLE_ERROR_CODES.has(code);
  }

  private static hasRetryableMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => includes(normalized, pattern));
  }

  private static formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

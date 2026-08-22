import get from 'lodash/get.js';
import includes from 'lodash/includes.js';
import isNumber from 'lodash/isNumber.js';
import isString from 'lodash/isString.js';
import type { LlmResponse } from '@/core/llm/types.js';
import type { ModelRunFailureCode, RunFailure } from '@/core/types.js';

export type AgentModelTurnRetryReason = 'transport_error' | 'empty_response' | 'context_window';

export type AgentModelTurnRetryDecision = {
  retryable: boolean;
  reason?: AgentModelTurnRetryReason;
  failure?: RunFailure;
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
const MODEL_FAILURE_BY_PROVIDER_CODE = new Map<string, ModelRunFailureCode>([
  ['insufficient_quota', 'quota'],
  ['credit_balance_exhausted', 'quota'],
  ['context_length_exceeded', 'context_window'],
  ['context_window_exceeded', 'context_window'],
  ['max_context_length_exceeded', 'context_window'],
  ['input_too_long', 'context_window'],
  ['prompt_too_long', 'context_window'],
]);
const MODEL_FAILURE_BY_STATUS = new Map<number, ModelRunFailureCode>([
  [400, 'request'],
  [401, 'authentication'],
  [403, 'permission'],
  [404, 'request'],
  [408, 'transport'],
  [409, 'transport'],
  [422, 'request'],
  [425, 'transport'],
  [429, 'rate_limit'],
  [500, 'transport'],
  [502, 'transport'],
  [503, 'transport'],
  [504, 'transport'],
]);
const MODEL_FAILURE_MESSAGE = new Map<ModelRunFailureCode, string>([
  ['authentication', 'Model authentication failed'],
  ['permission', 'Model access was denied'],
  ['quota', 'Model provider quota or billing limit reached'],
  ['rate_limit', 'Model provider rate limit reached'],
  ['context_window', 'Model context window was exceeded'],
  ['request', 'Model request was rejected'],
  ['transport', 'Model provider is temporarily unavailable'],
  ['empty_response', 'Model returned an empty response'],
  ['unknown', 'Model request failed'],
]);

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

const CONTEXT_WINDOW_MESSAGE_PATTERNS = [
  'exceeds the context window',
  'exceeded the context window',
  'context window exceeded',
  'context length exceeded',
  'maximum context length',
  'prompt is too long',
  'input is too long',
  'reduce the length of the messages',
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
      failure: AgentModelTurnRetryService.modelFailure('empty_response'),
      maxAttempts: EMPTY_RESPONSE_RETRY_ATTEMPTS,
      message: 'Model returned an empty response',
    };
  }

  private static resolveError(error: unknown): AgentModelTurnRetryDecision {
    const providerMessage = AgentModelTurnRetryService.formatErrorMessage(error);
    const providerCode = AgentModelTurnRetryService.readProviderErrorCode(error);
    const status = AgentModelTurnRetryService.readStatusCode(error);
    const failureCode = AgentModelTurnRetryService.resolveFailureCode({
      providerCode,
      providerMessage,
      status,
    });
    const failure = AgentModelTurnRetryService.modelFailure(failureCode);
    const message = AgentModelTurnRetryService.safeMessage(failureCode);

    if (failureCode === 'quota' || failureCode === 'context_window') {
      return { retryable: false, failure, maxAttempts: 1, message };
    }

    if (status !== undefined && NON_RETRYABLE_STATUS_CODES.has(status)) {
      return { retryable: false, failure, maxAttempts: 1, message };
    }

    if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) {
      return {
        retryable: true,
        reason: 'transport_error',
        failure,
        maxAttempts: TRANSPORT_RETRY_ATTEMPTS,
        message,
      };
    }

    if (AgentModelTurnRetryService.hasRetryableErrorCode(error)
      || AgentModelTurnRetryService.hasRetryableMessage(providerMessage)) {
      return {
        retryable: true,
        reason: 'transport_error',
        failure: AgentModelTurnRetryService.modelFailure('transport'),
        maxAttempts: TRANSPORT_RETRY_ATTEMPTS,
        message: AgentModelTurnRetryService.safeMessage('transport'),
      };
    }

    return { retryable: false, failure, maxAttempts: 1, message };
  }

  private static resolveFailureCode(args: {
    providerCode?: string;
    providerMessage: string;
    status?: number;
  }): ModelRunFailureCode {
    const providerFailure = args.providerCode
      ? MODEL_FAILURE_BY_PROVIDER_CODE.get(args.providerCode)
      : undefined;
    if (providerFailure) {
      return providerFailure;
    }

    if (AgentModelTurnRetryService.hasContextWindowMessage(args.providerMessage)) {
      return 'context_window';
    }

    return args.status === undefined ? 'unknown' : MODEL_FAILURE_BY_STATUS.get(args.status) ?? 'unknown';
  }

  private static readProviderErrorCode(error: unknown): string | undefined {
    const code: unknown = get(error, 'code')
      ?? get(error, 'error.code')
      ?? get(error, 'cause.code')
      ?? get(error, 'body.error.code')
      ?? get(error, 'response.data.error.code')
      ?? get(error, 'response.body.error.code');
    return isString(code) ? code.trim().toLowerCase() : undefined;
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

  private static hasContextWindowMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return CONTEXT_WINDOW_MESSAGE_PATTERNS.some((pattern) => includes(normalized, pattern));
  }

  private static formatErrorMessage(error: unknown): string {
    const messages = [
      error instanceof Error ? error.message : undefined,
      get(error, 'message'),
      get(error, 'error.message'),
      get(error, 'body.error.message'),
      get(error, 'response.data.error.message'),
      get(error, 'response.body.error.message'),
    ].filter((message): message is string => isString(message) && message.trim().length > 0);
    return messages.length ? messages.join('\n') : String(error);
  }

  private static modelFailure(code: ModelRunFailureCode): RunFailure {
    return { source: 'model', code };
  }

  private static safeMessage(code: ModelRunFailureCode): string {
    return MODEL_FAILURE_MESSAGE.get(code) ?? 'Model request failed';
  }
}

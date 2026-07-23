import { z } from 'zod';
import { LLM_PROVIDERS } from '../types.js';

export const LlmUsageCostSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('reported'),
    amountUsd: z.number().nonnegative()
      .describe('Provider-reported cost in US dollars.'),
  }),
  z.object({
    status: z.literal('partial'),
    reportedAmountUsd: z.number().nonnegative()
      .describe('Sum of provider-reported cost in US dollars.'),
    unavailableRequests: z.number().int().positive()
      .describe('Number of aggregated requests whose cost is unavailable.'),
  }),
  z.object({
    status: z.literal('unavailable'),
  }),
]);

export const LlmModelUsageSchema = z.object({
  provider: z.enum(LLM_PROVIDERS)
    .describe('Provider that produced this usage.'),
  model: z.string().min(1)
    .describe('Provider-returned model identifier.'),
  inputTokens: z.number().int().nonnegative()
    .describe('All input tokens, including cache reads and writes.'),
  billedInputTokens: z.number().int().nonnegative()
    .describe('Regular input tokens outside separately reported cache categories.'),
  outputTokens: z.number().int().nonnegative()
    .describe('Output tokens reported by the provider.'),
  totalTokens: z.number().int().nonnegative()
    .describe('Total normalized input and output tokens.'),
  cachedInputTokens: z.number().int().nonnegative().optional()
    .describe('Input tokens read from a provider cache.'),
  cacheWriteInputTokens: z.number().int().nonnegative().optional()
    .describe('Input tokens written to a provider cache.'),
  reasoningTokens: z.number().int().nonnegative().optional()
    .describe('Reasoning output tokens when reported separately.'),
  requests: z.number().int().positive()
    .describe('Successful provider responses represented by this record.'),
  cost: LlmUsageCostSchema,
});

/**
 * Durable, provider-neutral usage contract.
 *
 * New built-in adapters populate the cache, cost, and model-attribution
 * fields. They remain optional here so existing persisted sessions and custom
 * adapters written against the earlier aggregate-only contract still load.
 */
export const LlmUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative()
    .describe('All input tokens, including cache reads and writes.'),
  billedInputTokens: z.number().int().nonnegative().optional()
    .describe('Regular input tokens outside separately reported cache categories.'),
  outputTokens: z.number().int().nonnegative()
    .describe('Output tokens reported by providers.'),
  totalTokens: z.number().int().nonnegative()
    .describe('Total normalized input and output tokens.'),
  cachedInputTokens: z.number().int().nonnegative().optional()
    .describe('Input tokens read from provider caches.'),
  cacheWriteInputTokens: z.number().int().nonnegative().optional()
    .describe('Input tokens written to provider caches.'),
  reasoningTokens: z.number().int().nonnegative().optional()
    .describe('Reasoning output tokens when reported separately.'),
  requests: z.number().int().positive().optional()
    .describe('Successful provider responses represented by this record.'),
  cost: LlmUsageCostSchema.optional(),
  byModel: z.array(LlmModelUsageSchema).optional(),
  unattributedRequests: z.number().int().positive().optional()
    .describe('Legacy or custom-adapter requests without provider/model attribution.'),
}).passthrough();

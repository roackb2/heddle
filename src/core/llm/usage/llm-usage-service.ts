import type {
  LlmModelUsage,
  LlmProvider,
  LlmUsage,
  LlmUsageCost,
} from '../types.js';

export type LlmProviderRequestUsage = {
  provider: LlmProvider;
  model: string;
  billedInputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  totalTokens?: number;
  reasoningTokens?: number;
  providerReportedCostUsd?: number;
};

/**
 * Normalizes one provider request and aggregates usage across retries, turns,
 * and helper models without losing cache or model attribution.
 */
export class LlmUsageService {
  static fromProviderRequest(usage: LlmProviderRequestUsage): LlmUsage {
    const inputTokens =
      usage.billedInputTokens
      + (usage.cachedInputTokens ?? 0)
      + (usage.cacheWriteInputTokens ?? 0);
    const totalTokens = usage.totalTokens ?? inputTokens + usage.outputTokens;
    const cost = LlmUsageService.providerCost(usage.providerReportedCostUsd);
    const optionalCounters = LlmUsageService.optionalCounters(usage);
    const byModel: LlmModelUsage = {
      provider: usage.provider,
      model: usage.model,
      inputTokens,
      billedInputTokens: usage.billedInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens,
      ...optionalCounters,
      requests: 1,
      cost,
    };

    return {
      inputTokens,
      billedInputTokens: usage.billedInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens,
      ...optionalCounters,
      requests: 1,
      cost,
      byModel: [byModel],
    };
  }

  static aggregate(current: LlmUsage | undefined, next: LlmUsage | undefined): LlmUsage | undefined {
    if (!next) {
      return current ? LlmUsageService.normalize(current) : undefined;
    }

    if (!current) {
      return LlmUsageService.normalize(next);
    }

    const normalizedCurrent = LlmUsageService.normalize(current);
    const normalizedNext = LlmUsageService.normalize(next);
    const unattributedRequests =
      (normalizedCurrent.unattributedRequests ?? 0)
      + (normalizedNext.unattributedRequests ?? 0);
    const optionalCounters = LlmUsageService.optionalCounters({
      cachedInputTokens: LlmUsageService.sumOptional(
        normalizedCurrent.cachedInputTokens,
        normalizedNext.cachedInputTokens,
      ),
      cacheWriteInputTokens: LlmUsageService.sumOptional(
        normalizedCurrent.cacheWriteInputTokens,
        normalizedNext.cacheWriteInputTokens,
      ),
      reasoningTokens: LlmUsageService.sumOptional(
        normalizedCurrent.reasoningTokens,
        normalizedNext.reasoningTokens,
      ),
    });
    const requests = LlmUsageService.sumOptional(
      normalizedCurrent.requests,
      normalizedNext.requests,
    );
    const byModel = LlmUsageService.aggregateByModel([
      ...(normalizedCurrent.byModel ?? []),
      ...(normalizedNext.byModel ?? []),
    ]);

    return {
      inputTokens: normalizedCurrent.inputTokens + normalizedNext.inputTokens,
      billedInputTokens:
        (normalizedCurrent.billedInputTokens ?? 0)
        + (normalizedNext.billedInputTokens ?? 0),
      outputTokens: normalizedCurrent.outputTokens + normalizedNext.outputTokens,
      totalTokens: normalizedCurrent.totalTokens + normalizedNext.totalTokens,
      ...optionalCounters,
      ...(requests === undefined ? {} : { requests }),
      cost: LlmUsageService.aggregateCost([
        {
          cost: normalizedCurrent.cost ?? { status: 'unavailable' },
          requests: normalizedCurrent.requests,
        },
        {
          cost: normalizedNext.cost ?? { status: 'unavailable' },
          requests: normalizedNext.requests,
        },
      ]),
      ...(byModel ? { byModel } : {}),
      ...(unattributedRequests ? { unattributedRequests } : {}),
    };
  }

  private static normalize(usage: LlmUsage): LlmUsage {
    const cachedInputTokens = usage.cachedInputTokens ?? 0;
    const cacheWriteInputTokens = usage.cacheWriteInputTokens ?? 0;
    const billedInputTokens = usage.billedInputTokens
      ?? Math.max(usage.inputTokens - cachedInputTokens - cacheWriteInputTokens, 0);
    const attributedRequests = (usage.byModel ?? [])
      .reduce((total, modelUsage) => total + modelUsage.requests, 0);
    const unattributedRequests = usage.unattributedRequests
      ?? Math.max((usage.requests ?? 0) - attributedRequests, 0);

    return {
      ...usage,
      billedInputTokens,
      cost: usage.cost ?? { status: 'unavailable' },
      ...(usage.byModel
        ? { byModel: usage.byModel.map((modelUsage) => ({ ...modelUsage })) }
        : {}),
      ...(unattributedRequests ? { unattributedRequests } : {}),
    };
  }

  private static aggregateByModel(modelUsage: LlmModelUsage[]): LlmModelUsage[] | undefined {
    if (modelUsage.length === 0) {
      return undefined;
    }

    const aggregated = new Map<string, LlmModelUsage>();
    for (const usage of modelUsage) {
      const key = `${usage.provider}\u0000${usage.model}`;
      const current = aggregated.get(key);
      if (!current) {
        aggregated.set(key, { ...usage });
        continue;
      }

      aggregated.set(key, {
        provider: usage.provider,
        model: usage.model,
        inputTokens: current.inputTokens + usage.inputTokens,
        billedInputTokens: current.billedInputTokens + usage.billedInputTokens,
        outputTokens: current.outputTokens + usage.outputTokens,
        totalTokens: current.totalTokens + usage.totalTokens,
        ...LlmUsageService.optionalCounters({
          cachedInputTokens: LlmUsageService.sumOptional(
            current.cachedInputTokens,
            usage.cachedInputTokens,
          ),
          cacheWriteInputTokens: LlmUsageService.sumOptional(
            current.cacheWriteInputTokens,
            usage.cacheWriteInputTokens,
          ),
          reasoningTokens: LlmUsageService.sumOptional(
            current.reasoningTokens,
            usage.reasoningTokens,
          ),
        }),
        requests: current.requests + usage.requests,
        cost: LlmUsageService.aggregateCost([
          { cost: current.cost, requests: current.requests },
          { cost: usage.cost, requests: usage.requests },
        ]),
      });
    }

    return [...aggregated.values()];
  }

  private static providerCost(amountUsd: number | undefined): LlmUsageCost {
    return amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd < 0
      ? { status: 'unavailable' }
      : { status: 'reported', amountUsd };
  }

  private static aggregateCost(
    entries: Array<{ cost: LlmUsageCost; requests?: number }>,
  ): LlmUsageCost {
    let reportedAmountUsd = 0;
    let reported = false;
    let unavailableRequests = 0;

    for (const entry of entries) {
      if (entry.cost.status === 'reported') {
        reported = true;
        reportedAmountUsd += entry.cost.amountUsd;
        continue;
      }

      if (entry.cost.status === 'partial') {
        reported = true;
        reportedAmountUsd += entry.cost.reportedAmountUsd;
        unavailableRequests += entry.cost.unavailableRequests;
        continue;
      }

      unavailableRequests += entry.requests ?? 1;
    }

    if (!reported) {
      return { status: 'unavailable' };
    }

    return unavailableRequests > 0
      ? { status: 'partial', reportedAmountUsd, unavailableRequests }
      : { status: 'reported', amountUsd: reportedAmountUsd };
  }

  private static sumOptional(
    current: number | undefined,
    next: number | undefined,
  ): number | undefined {
    return current === undefined && next === undefined
      ? undefined
      : (current ?? 0) + (next ?? 0);
  }

  private static optionalCounters(usage: {
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    reasoningTokens?: number;
  }): Pick<
    LlmUsage,
    'cachedInputTokens' | 'cacheWriteInputTokens' | 'reasoningTokens'
  > {
    return {
      ...(usage.cachedInputTokens === undefined
        ? {}
        : { cachedInputTokens: usage.cachedInputTokens }),
      ...(usage.cacheWriteInputTokens === undefined
        ? {}
        : { cacheWriteInputTokens: usage.cacheWriteInputTokens }),
      ...(usage.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: usage.reasoningTokens }),
    };
  }
}

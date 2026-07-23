# LLM Usage

This domain owns Heddle's provider-neutral usage contract and aggregation
semantics.

## Owns

- translating one provider response into normalized input, cache-read,
  cache-write, output, reasoning, request, and cost categories;
- retaining the actual provider/model that produced usage;
- aggregating successful responses across retries, turns, and helper models;
- representing missing provider cost as unavailable instead of zero;
- backward-compatible parsing of older aggregate-only persisted usage.

## Does not own

- model pricing tables or estimated cost;
- provider request execution;
- retry policy;
- tenant budgets or enforcement.

Provider codecs call `LlmUsageService.fromProviderRequest`. Runtime code calls
`LlmUsageService.aggregate`; it must not hand-sum usage fields because doing so
can erase cache categories, partial cost, or model attribution.

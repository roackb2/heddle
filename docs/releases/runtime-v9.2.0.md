# `@heddleagent/runtime` 9.2.0

This release adds built-in model support for the GPT-6 and Claude 5 families. Model selectors, capability policy, context budgeting, and provider requests now recognize the new models without requiring adopters to define their own model metadata.

## What changed

- Add GPT-6 Astra, Sol, and Luna to the OpenAI model shortlist and account-sign-in policy, with model-specific reasoning-effort choices and context estimates.
- Add Claude Fable 5.1, Opus 5.5, and Sonnet 5.5 to the Anthropic shortlist, with reasoning-effort defaults, supported effort levels, and context estimates.
- Upgrade the Anthropic SDK and use the Messages streaming helper to support longer Claude responses. Claude 5 requests send the configured effort and an effort-aware output-token limit; a response truncated at `max_tokens` now fails instead of silently presenting partial output as complete.
- Preserve provider continuation blocks across Claude tool calls, including thinking and tool-use blocks, so follow-up requests can replay the provider's required context.
- Persist and validate the new model selections in conversation sessions; extend provider, session, and agent regressions.

## Upgrade and availability notes

The default OpenAI and Anthropic models do not change. New model choices require access to those models from the corresponding provider and appropriate credentials; this release adds client support, not provider entitlement. Anthropic SDK dependency moves to `^0.129.0`. The deprecated `@roackb2/*` packages and the independently versioned CLI and run-client packages are not part of this release.

## Verification

Release baseline: `yarn build`, `yarn test`, and Runtime package pack inspection. This release does not claim a live provider smoke test.

# Model Policy Boundary

`src/core/llm/models` is Heddle's source of truth for model-specific product
policy. If a decision depends on a model name, provider family, model
capability, or model-specific default, it belongs here.

This package owns:

- the curated list of models Heddle exposes in user-facing pickers and command
  help;
- provider-specific model allowlists, including OpenAI account sign-in support;
- reasoning-effort support, defaults, and per-model supported effort levels;
- model-specific system selections such as compaction and session-title models;
- credential-aware model availability and disabled-state explanations;
- estimated context windows and other model-specific capability estimates;
- future model-specific settings, limits, compatibility rules, and policy
  messages.

Other services should consume `ModelCatalogService` and `ModelPolicyService`.
They should not recreate model lists, infer reasoning support, invent context
window estimates, or decide model fallback policy locally.

## Extension Rules

- Add or update model availability in `model-catalog.ts`.
- Add or update model policy in `model-policy-service.ts`.
- Prefer named service methods over exporting raw constants for callers to
  combine themselves.
- Keep model fallback decisions here unless a caller needs a narrow operational
  fallback only to keep the program running after missing or corrupt input.
- When another layer needs model-specific data for UI, API, command execution,
  or runtime request building, expose it from this package and pass the resolved
  shape outward.

## What Does Not Belong Elsewhere

Do not put model-specific policy in control-plane controllers, terminal UI
services, web components, slash-command modules, runtime hosts, or provider
adapters when it can be represented here. Those layers may enforce or render
the policy, but they should not be the place where Heddle decides what a model
supports.

Provider adapters can still translate an already-approved Heddle policy value
into the provider wire format. If translation discovers a provider limitation,
move that limitation back into `ModelPolicyService` so every interface sees the
same behavior before a request is made.

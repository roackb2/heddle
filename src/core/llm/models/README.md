# Model Policy Boundary

`src/core/llm/models` is Heddle's source of truth for model-specific product
policy. If a decision depends on a model name, provider family, model
capability, or model-specific default, it belongs here.

This package owns:

- the curated list of models Heddle exposes in user-facing pickers and command
  help;
- the shared model-options contract consumed by control-plane clients, including
  provider-owned discovery such as installed Ollama models and reachable
  OpenAI-compatible provider profiles;
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

`ModelOptionsService` is the control-plane-facing aggregation boundary. It
combines the static catalog with provider discovery and returns the grouped
`modelOptions` shape used by web, TUI, task forms, and model slash-command
pickers. Provider-specific discovery logic should live with the provider adapter
or provider family, then be composed here.

## Extension Rules

- Add or update model availability in `model-catalog.ts`.
- Add or update provider-backed picker aggregation in `model-options-service.ts`.
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

## GPT-5.6 Contract

The GPT-5.6 product boundary is intentionally additive:

- the curated picker exposes `gpt-5.6-sol`, `gpt-5.6-terra`, and
  `gpt-5.6-luna`;
- the `gpt-5.6` Sol alias and all three explicit tiers are allowed through both
  Platform API-key and OpenAI account-sign-in paths;
- the catalog owns the 1,050,000-token context estimate;
- `ModelPolicyService` owns the supported `none` through `max` effort levels
  and the `medium` default;
- the OpenAI adapter translates Heddle's backward-compatible persisted
  `ultrahigh` value to the provider wire value `xhigh`.

Do not repeat this policy in a host UI. Clients receive concrete reasoning
options from the session runtime context so unsupported levels are disabled
before a request starts.

# Heddle Web V2

`src/web-v2` is the browser control plane served by `heddle daemon`.
It owns all active browser UI work.

## Boundary

- Browser code may talk to `api/` clients and local presentation/application
  modules.
- Browser code must not import `src/core` directly. Shared behavior belongs
  behind server APIs or in browser-safe contracts.
- Use the `@web/*` path alias for cross-folder v2 imports. Keep `./` imports
  for files in the same feature folder.
- Reuse tRPC-inferred server types from `AppRouter`. Do not redeclare DTOs in
  the browser unless they are truly web-interface view models.
- Start from shadcn/Tailwind tokens and primitives. Add custom CSS only when a
  real product need cannot be expressed by the shared design system.
- Use React Query + `@trpc/react-query` for all web-v2 API usage, including
  session listing, session details, prompt mutation, and subscription-driven
  UI updates. Prefer these APIs over custom `useEffect` fetch wrappers for
  loading/error/caching/refresh behavior.
- Keep workflow state close to the feature that owns it. Do not create broad
  global hooks until two real surfaces need the same behavior.
- Put reusable UI under `components/<feature>/` instead of nesting shared
  components under one page. Page folders should own only page-specific pieces.
- Keep shell/application hooks under `hooks/`; move feature-specific hooks next
  to their feature when they start owning data or behavior.
- Use `react-router` paths for page navigation. Do not use hash fragments for
  switching primary workbench surfaces.
- All user-facing strings go through nested JSON files in `i18n/locales/` so
  `en-us`, `zh-tw`, and `zh-cn` stay aligned from the start.
- Use shadcn primitives for real interaction behavior. The v2 shell starts with
  `resizable` for panes, `popover` for compact global settings, and `select`
  for language switching.
- Start with navigation structure only, then build one complete workflow at a
  time.
- Visual design follows [`design-language.md`](./design-language.md). Start with
  shadcn/Tailwind semantic tokens and extend them only when a concrete product
  need appears.

## Folder Shape

- `api/`: tRPC clients and inferred server contracts.
- `components/`: reusable v2-only components grouped by feature.
- `components/panels/`: session sidebar, conversation workspace, and context
  inspector shells.
- `components/ui/`: v2-owned shadcn primitives copied into this surface.
- `hooks/`: shell-level client state hooks.
- `i18n/`: typed locale dictionaries, locale JSON files, and the client
  translation provider.
- `layout/`: app frame and shell-level placement.
- `views/`: route-level workflow surfaces.

Browser-only behavior should stay in this folder. Shared behavior that must
also apply to terminal or future clients belongs in `src/client-shared`,
`src/server`, or the owning core domain.

## Conversation Runs

Web-v2 uses the same accepted-run model exposed by the Heddle SDK:

- prompt/direct-shell mutations return the run identity;
- `sessionEvents` discovers started and settled runs plus durable signals;
- `sessionRunEvents` carries ordered, replayable activity and one terminal;
- `sessionRunState.activeRun` recovers identity after a browser refresh;
- cancellation includes the currently observed `runId`.

Run cursor, duplicate, sequence-gap, and reconnect rules belong to
`ConversationRunConsumerService` from the public remote-run SDK layer, shared
with cli-v2 through `client-shared`. React hooks own only tRPC binding, cache
refresh, and browser presentation state.

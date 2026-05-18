# Heddle Web V2

`src/web-v2` is the parallel rebuild of the browser control plane. It exists so
new frontend work can grow from a clean foundation while `src/web` remains the
current user-facing UI.

## Boundary

- Browser code may talk to `api/` clients and local presentation/application
  modules.
- Browser code must not import `src/core` directly. Shared behavior belongs
  behind server APIs or in browser-safe contracts.
- Browser code must not import from `src/web`. If v2 needs a shadcn primitive
  or helper, copy it into `src/web-v2` so the old browser surface can be deleted
  cleanly later.
- Reuse tRPC-inferred server types from `AppRouter`. Do not redeclare DTOs in
  the browser unless they are truly web-interface view models.
- Start from shadcn/Tailwind tokens and primitives. Add custom CSS only when a
  real product need cannot be expressed by the shared design system.
- Keep workflow state close to the feature that owns it. Do not create broad
  global hooks until two real surfaces need the same behavior.
- Put reusable UI under `components/<feature>/` instead of nesting shared
  components under one page. Page folders should own only page-specific pieces.
- Keep shell/application hooks under `hooks/`; move feature-specific hooks next
  to their feature when they start owning data or behavior.
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
- `components/ui/`: v2-owned shadcn primitives copied into this surface.
- `hooks/`: shell-level client state hooks.
- `i18n/`: typed locale dictionaries, locale JSON files, and the client
  translation provider.
- `layout/`: app frame and shell-level placement.
- `views/`: route-level workflow surfaces.

V2 should borrow from v1 only when the source module already respects the API
boundary and does not carry legacy control-plane assumptions.

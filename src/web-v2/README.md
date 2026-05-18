# Heddle Web V2

`src/web-v2` is the parallel rebuild of the browser control plane. It exists so
new frontend work can grow from a clean foundation while `src/web` remains the
current user-facing UI.

## Boundary

- Browser code may talk to `api/` clients and local presentation/application
  modules.
- Browser code must not import `src/core` directly. Shared behavior belongs
  behind server APIs or in browser-safe contracts.
- Reuse tRPC-inferred server types from `AppRouter`. Do not redeclare DTOs in
  the browser unless they are truly web-interface view models.
- Start from shadcn/Tailwind tokens and primitives. Add custom CSS only when a
  real product need cannot be expressed by the shared design system.
- Keep workflow state close to the feature that owns it. Do not create broad
  global hooks until two real surfaces need the same behavior.
- Start with navigation structure only, then build one complete workflow at a
  time.
- Visual design follows [`design-language.md`](./design-language.md). Start with
  shadcn/Tailwind semantic tokens and extend them only when a concrete product
  need appears.

## Folder Shape

- `api/`: tRPC clients and inferred server contracts.
- `layout/`: app frame, navigation, and shell-level placement.
- `views/`: route-level workflow surfaces.
- `components/`: reusable v2-only presentation components when a second caller
  exists.

V2 should borrow from v1 only when the source module already respects the API
boundary and does not carry legacy control-plane assumptions.

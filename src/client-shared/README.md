# Shared Client Boundary

`src/client-shared` contains frontend-side API consumer code shared by Heddle
interfaces such as web-v2, TUI chat, `ask`, and future clients.

## Import Rule

Interface code may import API contracts and client utilities from this folder.
Interface code must not import core services, repositories, runtime toolkits,
server controllers, or copied backend DTOs directly.

`AppRouter` type imports are isolated to this folder. UI and controller code
should consume tRPC-derived aliases such as `RouterInputs`, `RouterOutputs`, and
the `ControlPlane*` types exported from `api/types.ts`.

## Owns

- tRPC-derived API type aliases;
- `ClientSharedApiLinkService` for shared tRPC link construction;
- `ClientSharedProxyApiService` for non-React proxy clients used by CLI/TUI/ask
  callers;
- `trpcReact` and `useControlPlaneTrpcClient` for React Query tRPC usage in
  React interfaces.

## Does Not Own

- server route implementation;
- core/domain behavior;
- UI rendering or workflow state specific to one interface.

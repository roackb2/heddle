# Shared Client Boundary

`src/client-shared` contains frontend-side API consumer code shared by Heddle
interfaces such as web-v2, TUI chat, `ask`, and future clients.

## Import Rule

Interface code may import API contracts and client utilities from this folder.
Interface code must not import core services, repositories, runtime toolkits,
server controllers, or copied backend DTOs directly.

`AppRouter` type imports are isolated to this folder. UI and service code
should consume tRPC-derived aliases such as `RouterInputs`, `RouterOutputs`, and
the `ControlPlane*` types exported from `api/types.ts`.

## Folder Shape

- `api/`: tRPC contracts, link services, proxy services, and
  `trpc-react.ts`, which owns the typed `@trpc/react-query` hook object.
- `services/`: client-side state and API-result shaping shared across
  frontends. These classes may consume tRPC-derived types, but must not import
  core services, server controllers, or UI renderers. Shared services own
  API-derived behavior such as transient session messages, session activity
  effect dispatch, and approval input display metadata.
- `hooks/`: React hooks. Files in this folder use `useXxx` naming and return
  hook-shaped values.

## Owns

- tRPC-derived API type aliases;
- `ClientSharedApiLinkService` for shared tRPC link construction;
- `ClientSharedProxyApiService` for non-React proxy clients used by CLI/TUI/ask
  callers;
- shared API-consumer services such as transient conversation message
  shaping, session activity effect dispatch, and approval payload display
  shaping;
- shared conversation-run cursor, duplicate suppression, terminal detection,
  and bounded reconnect policy;
- `trpcReact` for React Query tRPC usage in React interfaces;
- `useControlPlaneTrpcClient` for provider-level React client state.

## Does Not Own

- server route implementation;
- core/domain behavior;
- UI rendering or workflow state specific to one interface.

## Node Subscriptions

Browser clients can rely on the native `EventSource` implementation. Node
clients that use subscriptions must pass an EventSource-compatible implementation
into `ClientSharedProxyApiService.createClient`; `cli-v2` uses the `eventsource`
package for this so tRPC live events can stream in the terminal process.

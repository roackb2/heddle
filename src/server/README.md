# Server

`src/server` owns the local control-plane HTTP server and transport adapters
over core runtime behavior. It is not a product surface like the TUI or web UI.

## Lifecycle

`lifecycle.ts` owns the reusable control-plane server lifecycle:

- validate optional web assets;
- create the shared Express app;
- bind and close the HTTP server;
- register and refresh the global live-server record;
- register known workspaces from the runtime workspace catalog;
- start, sync, and stop the heartbeat scheduler host.

The lifecycle handle returns server facts such as `serverId`, endpoint, registry
path, workspace bootstrap roots, and `close()`.

CLI-only behavior stays outside this module. Command adapters such as
`src/cli-v2/commands/daemon-command.ts` decide whether to attach to an existing
live server, print messages, install signal handlers, and call `process.exit()`.

Embedded hosts such as future `chat-v2` startup should use the same lifecycle
path instead of inventing a TUI-only server path.

## Request Access Boundary

The reference server has two explicit access modes:

- `local` is the default single-operator daemon mode. It performs no
  authentication and is not safe to expose as a hosted or multi-tenant service.
- `hosted` requires the embedding product to authenticate every HTTP request
  and return the exact Heddle workspace/session scope for that principal.

Heddle enforces the resolved scope before tRPC or REST handlers run. A
client-supplied `workspaceId` or `sessionId` can select within that scope but
cannot broaden it. Hosted mode also disables daemon administration operations
that browse arbitrary directories or mutate the local workspace catalog.

The product remains responsible for its identity provider, cookies or bearer
tokens, tenant membership, role policy, CSRF/CORS/TLS, and audit retention.
Heddle consumes the already-resolved product identity:

```ts
import {
  HeddleServerAccessError,
  startHeddleControlPlaneServer,
} from '@roackb2/heddle/advanced';

const server = await startHeddleControlPlaneServer({
  mode: 'daemon',
  host: '127.0.0.1',
  port: 8765,
  workspaceRoot,
  stateRoot,
  accessControl: {
    mode: 'hosted',
    async resolveRequestAccess(request) {
      // Product-owned pseudocode: verify the request and resolve tenant scope.
      const productAccess = await productAuth.resolveAgentAccess(request);
      if (!productAccess) {
        return null;
      }

      return {
        principal: {
          id: productAccess.userId,
          auditMetadata: { tenantId: productAccess.tenantId },
        },
        scope: {
          workspaces: productAccess.workspaces.map((workspace) => ({
            workspaceId: workspace.heddleWorkspaceId,
            sessionIds: workspace.permittedSessionIds,
          })),
        },
      };
    },
    async authorizeOperation({ access, operation }) {
      if (!await productPolicy.permits(access.principal.id, operation)) {
        throw new HeddleServerAccessError(403, 'Operation not permitted.');
      }
    },
    async recordAuditEvent(event) {
      await productAuditLog.append(event);
    },
  },
});
```

Omit `sessionIds` to allow every session in a workspace. An empty array permits
workspace-level reads and operations but no session access. Session creation
requires unrestricted session scope because a newly generated ID cannot be in
a pre-resolved allowlist.

Approval resolution and run cancellation are checked by the same operation
authorizer as other control-plane calls. Before either mutation runs, Heddle
records the authenticated actor and request metadata in the workspace operation
log and invokes the optional host audit sink.

See [`access/README.md`](access/README.md) for the service boundary and
maintenance rules.

## Conversation Run Transport

The control plane exposes core `ConversationRunService` semantics rather than
maintaining a server-only run implementation:

- `controllers/trpc/control-plane/chat-session-run-stream.ts` owns the genuine
  adapter boundary: address sanitization, stable result projection,
  run-addressed replay, and lifecycle/terminal fanout;
- `chat-session-events.ts` owns only session/workspace lifecycle signals such
  as run discovery, queue changes, and approvals;
- `chat-sessions-controller.ts` owns conversation application orchestration and
  publishes activity once through the core run context;
- `routes/trpc/control-plane.ts` exposes lifecycle and run subscriptions.

Do not put conversation activity back on the session `EventEmitter`. Ordered
activity, replay, and terminals belong to `ConversationRunService`; duplicating
them on a second bus causes inconsistent CLI, web, and SDK behavior.

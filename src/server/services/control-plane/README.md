# Control-plane services

This folder contains server-side services for daemon/control-plane application
behavior that is not core domain semantics and not UI rendering.

Use this folder for process-local orchestration around the public API surface:
long-running run coordination, upload handling, transport-facing recovery, and
other server responsibilities that sit between tRPC/REST routes and core
services.

Do not put client-specific behavior here. Web, mobile, and terminal clients
should all see the same API behavior.

Do not put core chat/session meaning here. For example, whether a conversation
line is durable, pending, compacted, or model-facing belongs in
`src/core/chat/engine`, while this folder can coordinate when that core behavior
is invoked for a control-plane request.

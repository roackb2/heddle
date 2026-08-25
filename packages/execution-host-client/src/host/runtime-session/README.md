# Execution Host Runtime session

This is the provider-neutral application-service boundary for one
process-bound compatible Execution Host session. It coordinates immutable
scope binding, one-active-invocation admission, workflow dispatch, deadlines,
caller cancellation, bounded duplicate suppression, status, and shutdown.

It accepts only already verified execution identity and MCP capability values.
It does not parse HTTP, know AgentCore or another host provider, construct a
Heddle engine, schedule heartbeat tasks, persist product data, or provide
durable idempotency. A deployable host supplies the conversation and heartbeat
workflow executors and projects the resulting events onto its provider ingress.

Host implementations should import these types and services directly. Do not
rename their vocabulary or maintain a local copy. Provider bootstrap,
isolation, health-shape projection, HTTP/SSE framing, and process signals remain
the deployable host's responsibility.

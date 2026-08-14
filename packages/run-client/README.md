# `@heddleagent/run-client`

Status: **private package foundation; not published or installable**

This package will let browsers and JavaScript applications validate and
consume ordered Heddle run streams without installing an agent runtime.

## Owns

- browser-safe run protocol schemas and validation;
- cursor, sequence, terminal, replay, and reconnect consumption semantics; and
- the conventional fetch/SSE client at the future `/http-sse` subpath.

## Does not own

- the agent loop or model/tool execution;
- server-side run creation and persistence;
- product authentication, authorization, or UI state; or
- the separate Execution Host authority contract.

The package must stay browser-safe and independent of
`@heddleagent/runtime`. It consumes public events emitted by an adopter-owned
backend; it does not connect a browser directly to private runtime authority.

The planned public entrypoints are `.` and `/http-sse`. The current
implementation remains in `@roackb2/heddle-remote`; migration must move that
source into this package rather than continuing to compile runtime-owned source
or creating a second protocol implementation. See the
[package-family boundary](../README.md) before changing this status.

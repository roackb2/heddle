# Runtime Daemon

Owns runtime-host discovery through the daemon registry. The registry service
records known workspaces and live daemon ownership; the host resolver turns that
registry state into the active runtime-owner view used by CLI and server hosts.

Call `RuntimeDaemonRegistryService`, `RuntimeHostResolver`, and
`RuntimeHostMessages` directly. File I/O stays inside
`FileDaemonRegistryRepository`, and the persisted JSON contract lives in
`schemas.ts`.

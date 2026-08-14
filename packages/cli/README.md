# `@heddleagent/cli`

Status: **private package foundation; not published or installable**

This package will ship the finished Heddle coding-agent product. Installing it
will provide the `heddle` executable even though the npm package itself uses a
scoped name.

## Owns

- CLI command bootstrap and terminal/TUI workflows;
- the local daemon and browser control plane shipped with the coding agent;
- product defaults and local operator workflows; and
- packaging the executable user experience.

## Does not own

- reusable agent-runtime semantics or the embeddable SDK;
- browser-safe adopter run clients;
- separate Execution Host client contracts; or
- database adapters.

The CLI will depend on `@heddleagent/runtime`. Reusable behavior discovered in
the CLI should move into the runtime rather than being duplicated by other
products.

The current implementation and `heddle` binary remain in
`@roackb2/heddle`. Activate this package only after the CLI imports a deliberate
runtime public surface, retains its daemon/browser assets, and passes clean
binary-install verification. No `bin` field belongs in this foundation
manifest. See the [package-family boundary](../README.md) before changing this
status.

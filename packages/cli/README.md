# `@heddleagent/cli`

This package ships the finished Heddle coding-agent product. Installing it
provides the `heddle` executable even though the npm package itself uses a
scoped name.

```bash
npm install --global @heddleagent/cli
heddle --help
```

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

The CLI depends on `@heddleagent/runtime`. Reusable behavior discovered in the
CLI moves into the runtime rather than being duplicated by other products. The
package compiles the canonical `src/cli-v2` product surfaces and bundles the
canonical browser control-plane assets; it does not contain a second copy of
the runtime.

`@roackb2/heddle@5.13.0` remains installable for existing users. Version 6
changes the package coordinate while intentionally preserving the current CLI,
TUI, daemon, and browser control-plane feature set. See the
[package-family boundary](../README.md) before changing this responsibility.

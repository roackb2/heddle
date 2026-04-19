# Debugging

## Control Plane Layout Snapshots

When running the web client in development mode, the control plane can capture a local layout snapshot for debugging UI issues.

Use the debug buttons in the top toolbar:

- `Snapshot` captures layout metadata and selected DOM context.
- `Snapshot + Screen` also asks the browser for screen/tab capture permission and stores one PNG frame when available.

The keyboard shortcut `Cmd+Shift+D` / `Ctrl+Shift+D` captures a layout-only snapshot when focus is not inside an input.

Snapshots are saved locally under:

```text
.heddle/debug/dom-snapshots/
```

Each snapshot includes:

- viewport and visual viewport dimensions
- selected control-plane state such as active tab, session, turn, run state, and pending approval summary
- selected DOM landmarks such as the composer, approval card, approval actions, conversation scroller, and mobile panes
- scroll container dimensions and positions
- focusable element geometry
- basic problem checks for unreachable approval actions, clipped controls, oversized mobile composers, and hidden controls

If server persistence fails, the browser downloads the snapshot JSON locally. When a screenshot was captured, the PNG downloads with the same timestamp prefix.

The screenshot path is best-effort. Browser screen capture requires explicit user permission, and denial still leaves the structured layout snapshot available for debugging.

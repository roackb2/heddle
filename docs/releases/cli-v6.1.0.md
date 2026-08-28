# `@heddleagent/cli` 6.1.0

This release brings the completed core subagent experience to the installable
Heddle terminal and browser control plane.

## What changed

- subagents are on by default for new terminal and web turns, while users can
  turn them off from the shared host controls;
- terminal and web surfaces show correlated live child progress and compact
  settled child results, including after session reload;
- the main agent may explicitly select a Code child for bounded actions, and
  those actions use the existing terminal/web approval experience;
- Code children are labeled consistently without exposing raw child
  transcripts, provider details, or a second permission mode;
- prompt-free permission modes support unattended local workflows; and
- model quota/credit failures surface as explicit model failures rather than
  generic agent errors.

## Upgrade note

```bash
npm install --global @heddleagent/cli@6.1.0
```

This package requires `@heddleagent/runtime@^6.6.0`. Restart any running Heddle
daemon after upgrading so the terminal and browser clients use the same
runtime and built assets.

Subagents remain depth-one and same-workspace. Advanced worktree isolation,
provider-native delegation, and distributed child execution are not part of
this release.

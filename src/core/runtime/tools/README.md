# Runtime Tools

Runtime tools own the default tool bundle policy for generic agent execution.

`RuntimeToolService.createDefaultAgentTools(...)` builds the runtime's default
toolkits and host context. Individual tool behavior stays in `src/core/tools`;
this folder only decides which toolkits the generic runtime includes by default.

## Tool Profiles

`profiles/` owns runtime tool visibility profiles. A profile is an execution-time
filter over the default bundle, usually supplied by a custom-agent snapshot. It
does not execute tools, approve tools, or persist chat state.

The current presets are:

- `default`: expose the normal runtime bundle.
- `inspect`: expose workspace-read and shell-inspection tools only.
- `none`: expose no tools.
- `custom`: use explicit include/exclude/capability rules supplied by the
  caller.

Denied capabilities win before explicit includes. That keeps read-only agents
from accidentally exposing mutation or unknown MCP tools when a definition lists
them by name. Approval enforcement still belongs to `src/core/approvals`; tool
profiles only decide what the model can see for the turn.

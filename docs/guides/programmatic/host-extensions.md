# Host Extensions

Host extensions let a product add domain tools, toolkits, system context, MCP
policy, and artifact options at engine creation time.

```ts
import {
  createConversationEngine,
  defineHostExtension,
  type ToolDefinition,
} from '@heddleagent/runtime'

const createBrief: ToolDefinition = {
  name: 'create_project_brief',
  description: 'Create a project brief from source material.',
  capabilities: ['workspace.write'],
  parameters: {
    type: 'object',
    properties: {
      brief: { type: 'string' },
    },
    required: ['brief'],
  },
  execute: async (input) => ({ ok: true, output: { input } }),
}

const extension = defineHostExtension({
  id: 'project-brief-workspace',
  tools: [createBrief],
  systemContext: 'Use project brief tools when the user asks for durable planning documents.',
  artifacts: { enabled: true },
})

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.4',
  hostExtensions: [extension],
})
```

When multiple extensions are provided, Heddle composes them in declaration
order. Tool names and toolkit ids must be unique. Heddle rejects duplicates
before the first turn runs.

## Return-direct terminal tools

Use `returnDirect: true` when a successful host tool invocation is already the
canonical end of the run—for example, committing a workflow result through a
host-owned durable service:

```ts
const commitWorkflowResult: ToolDefinition = {
  name: 'commit_workflow_result',
  description: 'Commit the final workflow result after all required work is complete.',
  returnDirect: true,
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
    },
    required: ['summary'],
  },
  execute: async (input) => {
    const { summary } = input as { summary: string }
    await workflowResults.commit({ summary })
    return { ok: true, output: summary }
  },
}
```

After a successful return-direct result, Heddle records the tool result and
finishes the run without requesting ceremonial final text from the model. A
failed result remains in the transcript as an ordinary tool failure and the
model may recover within the remaining step budget. Heddle owns this portable
loop transition; the host continues to own authorization, durable effects,
idempotency, domain schemas, and the result text returned by the tool.

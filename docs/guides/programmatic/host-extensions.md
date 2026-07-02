# Host Extensions

Host extensions let a product add domain tools, toolkits, system context, MCP
policy, and artifact options at engine creation time.

```ts
import {
  createConversationEngine,
  defineHostExtension,
  type ToolDefinition,
} from '@roackb2/heddle'

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

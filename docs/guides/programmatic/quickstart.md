# Quickstart

Use `runConversationCli` when you want a working interactive conversation loop
before building a custom UI:

```ts
import { runConversationCli } from '@roackb2/heddle'

await runConversationCli({
  model: 'gpt-5.4',
})
```

Run the local SDK example:

```bash
yarn example:sdk:interactive
```

Use `createConversationEngine` when you are ready to own the host lifecycle,
commands, approvals, or custom rendering:

```ts
import {
  createConversationEngine,
  createConversationTextHost,
} from '@roackb2/heddle'

const workspaceRoot = process.cwd()
const stateRoot = `${workspaceRoot}/.heddle`

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: 'gpt-5.4',
  reasoningEffort: 'medium',
})

const session = engine.sessions.create({ name: 'Project assistant' })
const textHost = createConversationTextHost()

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize this project and list the main verification commands.',
  host: textHost.host,
})

textHost.renderTurnResult(result)
```

The text host gives a working console experience. Replace it with custom host
callbacks when your product has its own UI, approval flow, or telemetry path.

# Quickstart

Use `runConversationCli` when you want a working interactive conversation loop
before building a custom UI:

```ts
import { runConversationCli } from '@roackb2/heddle'

await runConversationCli({
  model: 'gpt-5.4',
})
```

The runner resolves credentials before starting the session and prints the
selected model and credential source. If the model has no usable credential, it
fails early with Heddle's standard setup message.

Run the local SDK example:

```bash
yarn example:sdk:interactive
```

Customize the starter loop when your product needs a little domain behavior but
not a full custom UI:

```ts
import { runConversationCli } from '@roackb2/heddle'

await runConversationCli({
  model: 'gpt-5.4',
  credentialPreflight: {
    missingCredentialHint: 'Run your product-specific auth setup first.',
  },
  systemContext: 'You are helping users operate this workspace.',
  promptLabel: 'workspace> ',
  formatPrompt: (prompt) => [
    prompt,
    '',
    'Operational requirements:',
    '1. Prefer host-provided tools when they apply.',
    '2. Summarize artifacts and validation status in the final answer.',
  ].join('\n'),
  localCommands: [{
    command: '/artifacts',
    description: 'print saved artifacts for the active session',
    run({ output, session }) {
      output.write(`Artifacts for ${session.id} are available through artifact tools.\n`)
    },
  }],
})
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

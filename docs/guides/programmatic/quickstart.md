# Quickstart

This is rung 1 of the programmatic ladder — the smallest working agent. See the
[programmatic guide index](README.md) for the full climb (add capabilities →
shape output → lifecycle → storage), and [`examples/sdk/`](../../../examples/sdk/README.md)
for runnable versions.

Use `runQuickstartConversationCli` when you want a working interactive conversation loop
before building a custom UI:

```ts
import { runQuickstartConversationCli } from '@roackb2/heddle'

await runQuickstartConversationCli()
```

The runner chooses reasonable SDK defaults: the current working directory as the
workspace, `.heddle` under that workspace for conversation state, no default
step budget, no automatic memory maintenance, and the first configured model from
`HEDDLE_MODEL`, `HEDDLE_EXAMPLE_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, or
Heddle's built-in OpenAI default. It resolves credentials before starting the
session and prints the selected model and credential source. If the model has no
usable credential, it fails early with Heddle's standard setup message.

This quickstart runner is intentionally smaller than Heddle's product CLI/TUI.
Use it to get an SDK conversation working quickly, then move to
`createConversationEngine` when your product needs custom UI state, rendering,
approval screens, session browsers, or control-plane lifecycle.

Run the local SDK example:

```bash
yarn example:sdk:interactive
```

Customize the starter loop when your product needs a little domain behavior but
not a full custom UI:

```ts
import { runQuickstartConversationCli } from '@roackb2/heddle'

await runQuickstartConversationCli({
  model: process.env.MY_PRODUCT_MODEL,
  reasoningEffort: process.env.MY_PRODUCT_REASONING_EFFORT,
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

If your host must prepare extensions before starting the loop, reuse the same
default resolver instead of rebuilding path and model fallbacks:

```ts
import {
  resolveQuickstartConversationCliDefaults,
  runQuickstartConversationCli,
} from '@roackb2/heddle'

const runtime = resolveQuickstartConversationCliDefaults({
  model: process.env.MY_PRODUCT_MODEL,
  reasoningEffort: process.env.MY_PRODUCT_REASONING_EFFORT,
})

const hostExtensions = [
  // prepare your generic host extensions with runtime.stateRoot
]

await runQuickstartConversationCli({
  ...runtime,
  hostExtensions,
})
```

Pass `maxSteps` only when the host intentionally wants a hard turn budget.

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

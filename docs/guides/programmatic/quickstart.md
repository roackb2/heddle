# Quickstart

This is rung 1 of the programmatic ladder — the smallest working agent. See the
[programmatic guide index](README.md) for the full climb (add capabilities →
shape output → lifecycle → storage), and [`examples/sdk/`](../../../examples/sdk/README.md)
for runnable versions.

Start with the headless service when your product owns its input/output but not
the agent lifecycle yet:

```ts
import { ConversationAgentService } from '@roackb2/heddle'

const agent = new ConversationAgentService()
const result = await agent.send({
  prompt: 'Summarize this project and identify the main verification path.',
})

console.log(result.summary)
console.log(result.activities)
```

This resolves the workspace, `.heddle` state root, configured model, and
credential; race-safely ensures the stable `session-1`; and returns Heddle's
structured turn result plus the ordered conversation activities observed during
the turn. Repeated `send` calls continue the same durable conversation. Supply
an explicit stable session ID for product scope:

```ts
const agent = new ConversationAgentService({
  session: { id: trustedProductConversationId, name: 'Product assistant' },
  systemContext: 'Help the user work with this product.',
})
```

Creation fields never overwrite an existing session with that ID. A hosted
service must derive the ID and repository scope from trusted server-side
identity; Heddle does not provide authentication or tenant mapping.

The result and activities are trusted in-process host data; they may include
tool input/output, local paths, or other internal details. Do not serialize them
directly to an untrusted browser. Use a host-owned public projection and the
[remote run contracts](remote-runs.md) when crossing a network boundary.

Run the headless repository example:

```bash
yarn example:sdk:headless "What does this project do?"
```

If your product already owns a server or remote transport, use the
[integration-layer chooser](integration-layers.md) to skip directly to the
lowest matching hosting boundary.

## Optional terminal loop

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

This runner adds readline, text rendering, and local commands around the same
generic runtime defaults. It is intentionally smaller than Heddle's product
CLI/TUI. Use `ConversationAgentService` for structured headless output, or move
to `createConversationEngine` when your product needs full session and turn
lifecycle control.

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

const session = await engine.sessions.create({ name: 'Project assistant' })
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

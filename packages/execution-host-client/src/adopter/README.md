# Adopter hosted-conversation client

This browser-safe module is the public client for the authenticated
hosted-conversation route served by Heddle's Node adopter HTTP service. Product
code supplies its own user access token and presents canonical stream events;
the package owns request validation, redirect refusal, bounded public errors,
ordered SSE parsing, identity binding, terminal settlement, cancellation, and
ambiguous interruption behavior.

It does not acquire product authentication tokens, persist UI state, decide how
events are presented, or expose Execution Host credentials to the browser.

```ts
import {
  HostedConversationClient,
} from '@heddleagent/execution-host-client/adopter'

const conversations = new HostedConversationClient()

for await (const event of conversations.streamTurn({
  prompt: 'Summarize my workspace.',
  accessToken: productSessionToken,
  signal,
})) {
  present(event)
}
```

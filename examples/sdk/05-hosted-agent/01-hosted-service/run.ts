/**
 * Stage 05.1 runner: exercise a hosted run without choosing HTTP, SSE, or a UI.
 *
 * Assumptions: the TypeScript host owns account/session identity and process
 * lifetime; Heddle owns the persisted conversation and active run lifecycle.
 * Run: yarn example:sdk:hosted-agent "What does this repository do?"
 */
import type { HostedAgentRunStreamItem } from './agent-service.js';
import { EXAMPLE_ACCOUNT_ID, createExampleHostedAgentService } from './example-agent.js';

const cancelDemo = process.argv.includes('--cancel-demo');
const prompt = process.argv
  .slice(2)
  .filter((argument) => argument !== '--cancel-demo')
  .join(' ')
  || 'Read the repository README and summarize the project in three sentences.';
const sessionId = process.env.HEDDLE_EXAMPLE_SESSION_ID ?? 'hosted-agent-service-example';
const agent = createExampleHostedAgentService();
const accepted = await agent.start({ accountId: EXAMPLE_ACCOUNT_ID, sessionId, prompt });

console.log(`Accepted ${accepted.runId}.`);

let cursor = 0;
let terminal: HostedAgentRunStreamItem | undefined;
for await (const event of agent.subscribe({ accountId: EXAMPLE_ACCOUNT_ID, runId: accepted.runId })) {
  cursor = event.sequence;
  terminal = renderEvent(event);
  if (event.kind === 'activity') {
    console.log(`Disconnecting after sequence ${cursor}; the run continues in the host process.`);
    break;
  }
}

if (!terminal) {
  console.log(`Reconnecting from sequence ${cursor}.`);
  for await (const event of agent.subscribe({
    accountId: EXAMPLE_ACCOUNT_ID,
    runId: accepted.runId,
    afterSequence: cursor,
  })) {
    renderEvent(event);
  }
}

if (cancelDemo) {
  const cancellation = await agent.start({
    accountId: EXAMPLE_ACCOUNT_ID,
    sessionId: `${sessionId}-cancel-${Date.now()}`,
    prompt: 'Inspect this repository carefully and report its main subsystems.',
  });
  console.log(`Cancelling ${cancellation.runId}: ${agent.cancel(EXAMPLE_ACCOUNT_ID, cancellation.runId)}`);
  for await (const event of agent.subscribe({
    accountId: EXAMPLE_ACCOUNT_ID,
    runId: cancellation.runId,
  })) {
    renderEvent(event);
  }
}

function renderEvent(event: HostedAgentRunStreamItem): HostedAgentRunStreamItem | undefined {
  if (event.kind === 'activity') {
    console.log(`[${event.sequence}] activity ${event.activity.type}`);
    return undefined;
  }
  if (event.kind === 'result') {
    console.log(`[${event.sequence}] result ${event.result.summary}`);
    return event;
  }
  if (event.kind === 'cancelled') {
    console.log(`[${event.sequence}] cancelled ${event.reason}`);
    return event;
  }
  console.log(`[${event.sequence}] error ${event.error.message}`);
  return event;
}

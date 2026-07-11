/**
 * Stage 05.3 runner: consume the stage-2 API with browser-compatible fetch/SSE.
 *
 * This is protocol code, not a UI framework. The product still owns messages,
 * rendering, optimistic state, retry UX, and product-specific terminal data.
 * Start the stage-2 server first, then run this script with the same token.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { ConversationRunConsumerService } from '../../../../src/core/chat/remote/index.js';
import {
  HostedAgentClient,
  HostedAgentClientError,
} from './browser-client.js';
import type { HostedAgentRunEvent } from '../02-http-sse-api/contracts.js';

type HostedAgentRunReference = { runId: string };
type HostedAgentRunConsumer = ConversationRunConsumerService<HostedAgentRunReference>;

const bearerToken = process.env.HEDDLE_EXAMPLE_BEARER_TOKEN;
if (!bearerToken) {
  throw new Error('Set HEDDLE_EXAMPLE_BEARER_TOKEN to the secret used by the hosted API example.');
}

const cancelDemo = process.argv.includes('--cancel-demo');
const prompt = process.argv
  .slice(2)
  .filter((argument) => argument !== '--cancel-demo')
  .join(' ')
  || 'Read the repository README and summarize the project in three sentences.';
const baseUrl = process.env.HEDDLE_EXAMPLE_AGENT_URL ?? 'http://127.0.0.1:8787/api/agent';
const sessionId = process.env.HEDDLE_EXAMPLE_SESSION_ID ?? 'hosted-agent-browser-example';
const client = new HostedAgentClient({
  baseUrl,
  getHeaders: () => ({ Authorization: `Bearer ${bearerToken}` }),
});

const accepted = await client.start({ sessionId, prompt });
console.log(`Accepted ${accepted.runId}.`);
const consumer = createRunConsumer(accepted.runId);
await disconnectAfterFirstActivity(client, consumer);
const cursor = requireSubscriptionInput(consumer).afterSequence;
console.log(`Browser subscription disconnected at sequence ${cursor}; reconnecting.`);
const terminal = await consumeUntilTerminal(client, consumer);
console.log(`Run settled as ${terminal.kind}.`);

if (cancelDemo) {
  const cancellation = await client.start({
    sessionId: `${sessionId}-cancel-${Date.now()}`,
    prompt: 'Inspect this repository carefully and report its main subsystems.',
  });
  const cancelled = await client.cancel(cancellation.runId);
  console.log(`Cancellation accepted: ${cancelled.cancelled}.`);
  const cancelledTerminal = await consumeUntilTerminal(
    client,
    createRunConsumer(cancellation.runId),
  );
  if (cancelledTerminal.kind !== 'cancelled') {
    throw new Error(`Expected a cancelled terminal, received ${cancelledTerminal.kind}.`);
  }
}

function createRunConsumer(runId: string): HostedAgentRunConsumer {
  const consumer = new ConversationRunConsumerService<HostedAgentRunReference>({
    retry: { maxAttempts: 5, baseDelayMs: 250, maxDelayMs: 2_000 },
  });
  consumer.select({ runId });
  return consumer;
}

async function disconnectAfterFirstActivity(
  agent: HostedAgentClient,
  consumer: HostedAgentRunConsumer,
): Promise<void> {
  const subscription = new AbortController();
  let disconnected = false;
  try {
    await agent.subscribe({
      ...requireSubscriptionInput(consumer),
      signal: subscription.signal,
      onEvent: (event) => {
        const acceptance = consumer.accept(event);
        if (!acceptance.accepted) {
          return;
        }
        renderEvent(event);
        if (event.kind === 'activity') {
          disconnected = true;
          subscription.abort();
        }
      },
    });
  } catch (error) {
    if (!subscription.signal.aborted) {
      throw error;
    }
  }
  if (!disconnected) {
    throw new Error('The first subscription ended before receiving an activity.');
  }
}

async function consumeUntilTerminal(
  agent: HostedAgentClient,
  consumer: HostedAgentRunConsumer,
): Promise<HostedAgentRunEvent> {
  let terminal: HostedAgentRunEvent | undefined;
  let lastError: unknown;

  while (!terminal) {
    try {
      await agent.subscribe({
        ...requireSubscriptionInput(consumer),
        onEvent: (event) => {
          const acceptance = consumer.accept(event);
          if (!acceptance.accepted) {
            return;
          }
          renderEvent(event);
          if (acceptance.terminal) {
            terminal = event;
          }
        },
      });
      if (!terminal) {
        lastError = new Error('Hosted agent event stream ended before a terminal event.');
      }
    } catch (error) {
      if (error instanceof HostedAgentClientError
        && (error.status === undefined || error.status < 500)) {
        throw error;
      }
      lastError = error;
    }

    if (!terminal) {
      const retry = consumer.nextRetry();
      if (!retry) {
        throw lastError instanceof Error
          ? lastError
          : new Error('Hosted agent run exhausted its reconnect attempts.');
      }
      await delay(retry.delayMs);
    }
  }

  return terminal;
}

function requireSubscriptionInput(consumer: HostedAgentRunConsumer) {
  const input = consumer.subscriptionInput();
  if (!input) {
    throw new Error('Hosted agent run no longer accepts subscriptions.');
  }
  return input;
}

function renderEvent(event: HostedAgentRunEvent): void {
  if (event.kind === 'activity') {
    console.log(`[${event.sequence}] activity ${event.activity.type}`);
    return;
  }
  if (event.kind === 'result') {
    console.log(`[${event.sequence}] result ${event.result.summary}`);
    return;
  }
  if (event.kind === 'cancelled') {
    console.log(`[${event.sequence}] cancelled ${event.reason}`);
    return;
  }
  console.log(`[${event.sequence}] error ${event.error.message}`);
}

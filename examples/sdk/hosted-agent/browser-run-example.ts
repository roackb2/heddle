// Rung 4 — framework-neutral fetch/SSE client with application-owned reconnect.
// Start http-api-example.ts first, then run this script with the same token.
import { setTimeout as delay } from 'node:timers/promises';
import {
  HostedAgentClient,
  HostedAgentClientError,
} from './browser-client.js';
import type { HostedAgentRunEvent } from './contracts.js';

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
const cursor = await disconnectAfterFirstActivity(client, accepted.runId);
console.log(`Browser subscription disconnected at sequence ${cursor}; reconnecting.`);
const terminal = await consumeUntilTerminal(client, accepted.runId, cursor);
console.log(`Run settled as ${terminal.kind}.`);

if (cancelDemo) {
  const cancellation = await client.start({
    sessionId: `${sessionId}-cancel-${Date.now()}`,
    prompt: 'Inspect this repository carefully and report its main subsystems.',
  });
  const cancelled = await client.cancel(cancellation.runId);
  console.log(`Cancellation accepted: ${cancelled.cancelled}.`);
  const cancelledTerminal = await consumeUntilTerminal(client, cancellation.runId, 0);
  if (cancelledTerminal.kind !== 'cancelled') {
    throw new Error(`Expected a cancelled terminal, received ${cancelledTerminal.kind}.`);
  }
}

async function disconnectAfterFirstActivity(agent: HostedAgentClient, runId: string): Promise<number> {
  const subscription = new AbortController();
  let cursor = 0;
  let disconnected = false;
  try {
    await agent.subscribe({
      runId,
      signal: subscription.signal,
      onEvent: (event) => {
        cursor = event.sequence;
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
  return cursor;
}

async function consumeUntilTerminal(
  agent: HostedAgentClient,
  runId: string,
  initialCursor: number,
): Promise<HostedAgentRunEvent> {
  let cursor = initialCursor;
  let terminal: HostedAgentRunEvent | undefined;

  for (let attempt = 0; attempt < 5 && !terminal; attempt += 1) {
    try {
      await agent.subscribe({
        runId,
        afterSequence: cursor,
        onEvent: (event) => {
          cursor = Math.max(cursor, event.sequence);
          renderEvent(event);
          if (event.kind !== 'activity') {
            terminal = event;
          }
        },
      });
    } catch (error) {
      if (error instanceof HostedAgentClientError
        && (error.status === undefined || error.status < 500)) {
        throw error;
      }
    }
    if (!terminal) {
      await delay(Math.min(250 * (2 ** attempt), 2_000));
    }
  }

  if (!terminal) {
    throw new Error(`Run ${runId} did not reach a terminal event after bounded reconnects.`);
  }
  return terminal;
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

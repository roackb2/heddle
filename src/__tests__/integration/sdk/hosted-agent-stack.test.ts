import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import type {
  ConversationActivity,
  ConversationEngine,
  ConversationTurnResultSummary,
  CreateConversationSessionInput,
  SubmitConversationTurnInput,
} from '../../../index.js';
import {
  HostedAgentRunNotFoundError,
  HostedAgentService,
} from '../../../../examples/sdk/hosted-agent/agent-service.js';
import {
  HostedAgentClient,
} from '../../../../examples/sdk/hosted-agent/browser-client.js';
import type { HostedAgentRunEvent } from '../../../../examples/sdk/hosted-agent/contracts.js';
import {
  HostedAgentApiError,
  createHostedAgentApiRouter,
} from '../../../../examples/sdk/hosted-agent/http-api.js';

describe('hosted agent SDK stack example', () => {
  it('reuses a durable session and replays from the subscriber cursor', async () => {
    const harness = createEngineHarness();
    const agent = new HostedAgentService({ createEngine: harness.createEngine });
    const accepted = await agent.start({
      accountId: 'account-a',
      sessionId: 'conversation-a',
      prompt: 'First prompt',
    });

    const first = await firstEvent(agent.subscribe({
      accountId: 'account-a',
      runId: accepted.runId,
    }));
    expect(first).toMatchObject({ kind: 'activity', sequence: 1 });
    expect(() => agent.subscribe({
      accountId: 'account-b',
      runId: accepted.runId,
    })).toThrow(HostedAgentRunNotFoundError);

    (await harness.waitForTurn(0)).complete();
    const replay = await collect(agent.subscribe({
      accountId: 'account-a',
      runId: accepted.runId,
      afterSequence: first.sequence,
    }));
    expect(replay).toMatchObject([{ kind: 'result', sequence: 2 }]);

    const second = await agent.start({
      accountId: 'account-a',
      sessionId: 'conversation-a',
      prompt: 'Second prompt',
    });
    (await harness.waitForTurn(1)).complete();
    await collect(agent.subscribe({ accountId: 'account-a', runId: second.runId }));
    expect(harness.createdSessionIds).toEqual(['conversation-a']);
  });

  it('cancels the Heddle run through the owned service handle', async () => {
    const harness = createEngineHarness();
    const agent = new HostedAgentService({ createEngine: harness.createEngine });
    const accepted = await agent.start({
      accountId: 'account-a',
      sessionId: 'cancelled-conversation',
      prompt: 'Keep working until cancelled',
    });
    const events = collect(agent.subscribe({ accountId: 'account-a', runId: accepted.runId }));
    await harness.waitForTurn(0);

    expect(agent.cancel('account-a', accepted.runId)).toBe(true);
    await expect(events).resolves.toMatchObject([
      { kind: 'activity', sequence: 1 },
      { kind: 'cancelled', sequence: 2 },
    ]);
  });

  it('serves authenticated SSE replay to the framework-neutral browser client', async () => {
    const harness = createEngineHarness();
    const agent = new HostedAgentService({ createEngine: harness.createEngine });
    const api = await startApi(agent);

    try {
      const client = createClient(api.baseUrl, 'token-a');
      const otherAccountClient = createClient(api.baseUrl, 'token-b');
      const accepted = await client.start({
        sessionId: 'browser-conversation',
        prompt: 'Stream this turn',
      });
      const subscription = new AbortController();
      let cursor = 0;

      const disconnected = client.subscribe({
        runId: accepted.runId,
        signal: subscription.signal,
        onEvent: (event) => {
          cursor = event.sequence;
          subscription.abort();
        },
      });
      await expect(disconnected).rejects.toMatchObject({ name: 'AbortError' });
      const turn = await harness.waitForTurn(0);
      expect(turn.signal?.aborted).toBe(false);

      turn.complete();
      const replay: HostedAgentRunEvent[] = [];
      await client.subscribe({
        runId: accepted.runId,
        afterSequence: cursor,
        onEvent: (event) => replay.push(event),
      });
      expect(replay).toEqual([
        expect.objectContaining({
          kind: 'result',
          sequence: 2,
          result: {
            outcome: 'done',
            summary: 'Completed: Stream this turn',
          },
        }),
      ]);

      await expect(otherAccountClient.subscribe({
        runId: accepted.runId,
        onEvent: () => undefined,
      })).rejects.toMatchObject({
        status: 404,
        code: 'run_not_found',
      });

      const malformedCursor = await fetch(`${api.baseUrl}/runs/${accepted.runId}/events?after=bad`, {
        headers: { Authorization: 'Bearer token-a' },
      });
      expect(malformedCursor.status).toBe(400);
      expect(malformedCursor.headers.get('content-type')).toContain('application/json');

      const headerResume = await fetch(`${api.baseUrl}/runs/${accepted.runId}/events`, {
        headers: {
          Authorization: 'Bearer token-a',
          'Last-Event-ID': '1',
        },
      });
      expect(await headerResume.text()).toContain('id: 2\n');

      const queryWins = await fetch(`${api.baseUrl}/runs/${accepted.runId}/events?after=0`, {
        headers: {
          Authorization: 'Bearer token-a',
          'Last-Event-ID': '1',
        },
      });
      expect(await queryWins.text()).toContain('id: 1\n');

      const cancellation = await client.start({
        sessionId: 'browser-cancellation',
        prompt: 'Wait for cancellation',
      });
      await harness.waitForTurn(1);
      await expect(client.cancel(cancellation.runId)).resolves.toEqual({ cancelled: true });
      const cancellationEvents: HostedAgentRunEvent[] = [];
      await client.subscribe({
        runId: cancellation.runId,
        onEvent: (event) => cancellationEvents.push(event),
      });
      expect(cancellationEvents.at(-1)).toMatchObject({ kind: 'cancelled' });
      expect(api.errors).toEqual([]);
    } finally {
      await closeServer(api.server);
    }
  });
});

function createEngineHarness() {
  const sessions = new Map<string, { id: string }>();
  const turns: ControlledTurn[] = [];
  const createdSessionIds: string[] = [];

  return {
    createdSessionIds,
    turns,
    createEngine: (): ConversationEngine => ({
      sessions: {
        readExisting: (id: string) => sessions.get(id),
        create: (input: CreateConversationSessionInput = {}) => {
          const session = { id: input.id ?? `session-${sessions.size + 1}` };
          sessions.set(session.id, session);
          createdSessionIds.push(session.id);
          return session;
        },
      },
      turns: {
        submit: async (input: SubmitConversationTurnInput) => {
          const completion = deferred<void>();
          const turn: ControlledTurn = {
            signal: input.abortSignal,
            complete: () => completion.resolve(),
          };
          turns.push(turn);
          input.host?.events?.onActivity?.({
            type: 'assistant.stream',
            step: 1,
            text: 'Working',
            done: false,
            timestamp: new Date().toISOString(),
          } as ConversationActivity);
          await waitForCompletion(completion.promise, input.abortSignal);
          return createTurnResult(input.sessionId, input.prompt);
        },
      },
      artifacts: {},
    } as unknown as ConversationEngine),
    async waitForTurn(index: number): Promise<ControlledTurn> {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const turn = turns[index];
        if (turn) {
          return turn;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`Timed out waiting for controlled turn ${index}.`);
    },
  };
}

type ControlledTurn = {
  signal?: AbortSignal;
  complete(): void;
};

function createTurnResult(sessionId: string, prompt: string): ConversationTurnResultSummary {
  return {
    outcome: 'done',
    summary: `Completed: ${prompt}`,
    session: { id: sessionId } as ConversationTurnResultSummary['session'],
    artifacts: [],
    toolResults: [],
  };
}

async function waitForCompletion(completion: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await completion;
    return;
  }
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new Error('Controlled turn aborted.'));
    signal.addEventListener('abort', onAbort, { once: true });
    completion.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function firstEvent<T>(events: AsyncIterable<T>): Promise<T> {
  for await (const event of events) {
    return event;
  }
  throw new Error('Expected at least one run event.');
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) {
    values.push(event);
  }
  return values;
}

async function startApi(agent: HostedAgentService): Promise<{
  baseUrl: string;
  server: Server;
  errors: unknown[];
}> {
  const errors: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createHostedAgentApiRouter({
    agent,
    authenticate: async (request) => {
      const token = request.header('authorization')?.replace(/^Bearer /, '');
      const accountId = new Map([
        ['token-a', 'account-a'],
        ['token-b', 'account-b'],
      ]).get(token ?? '');
      if (!accountId) {
        throw new HostedAgentApiError(401, 'unauthorized', 'Invalid test token.');
      }
      return { accountId };
    },
    onError: (error) => errors.push(error),
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/agent`,
    server,
    errors,
  };
}

function createClient(baseUrl: string, token: string): HostedAgentClient {
  return new HostedAgentClient({
    baseUrl,
    getHeaders: () => ({ Authorization: `Bearer ${token}` }),
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

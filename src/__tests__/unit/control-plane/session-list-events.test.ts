import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConversationRunService } from '@/core/chat/runs/index.js';
import { ControlPlaneChatSessionEventsController } from '@/server/controllers/trpc/control-plane/chat-session-events.js';
import { ControlPlaneChatSessionRunStreamController } from '@/server/controllers/trpc/control-plane/chat-session-run-stream.js';
import { ControlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';
import type { ControlPlaneSessionsEventEnvelope } from '@/server/control-plane-types.js';

describe('ControlPlaneChatSessionsController session list events', () => {
  it('emits a sessions.updated event when the session catalog changes', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-session-list-events-'));
    mkdirSync(stateRoot, { recursive: true });
    const catalogPath = join(stateRoot, 'chat-sessions.catalog.json');
    writeFileSync(catalogPath, JSON.stringify({ version: 1, sessions: [] }));

    const controller = new ControlPlaneChatSessionsController();
    const abort = new AbortController();
    const events = controller.subscribeSessionListEvents({
      workspaceId: 'workspace-1',
      stateRoot,
      signal: abort.signal,
    });
    const next = nextSessionListEvent(events);

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    writeFileSync(catalogPath, JSON.stringify({
      version: 1,
      sessions: [{
        id: 'session-1',
        name: 'Renamed session',
        updatedAt: new Date().toISOString(),
      }],
    }));

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        type: 'sessions.updated',
      },
    });

    abort.abort();
    await events.return(undefined);
  });

  it('emits workspace-scoped run identity events without duplicating activities', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-session-list-events-'));
    mkdirSync(stateRoot, { recursive: true });

    const controller = new ControlPlaneChatSessionsController();
    const abort = new AbortController();
    const events = controller.subscribeSessionListEvents({
      workspaceId: 'workspace-1',
      stateRoot,
      signal: abort.signal,
    });
    const next = nextSessionListEvent(events, (event) => event.type === 'session.run.updated');

    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: Reflect.get(controller, 'sessionEventBus'),
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    });
    publisher.publishRunUpdated({
      runId: 'run-1',
      acceptedAt: '2026-06-12T00:00:00.000Z',
    }, 'started');

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        type: 'session.run.updated',
        sessionId: 'session-1',
        status: 'started',
        run: { runId: 'run-1' },
      },
    });

    abort.abort();
    await events.return(undefined);
  });

  it('observes the terminal from run acceptance even when replay trims early activity', async () => {
    const eventBus = new EventEmitter();
    const runService = new ConversationRunService<{ workspaceId: string; sessionId: string }>({
      addressKey: ({ workspaceId, sessionId }) => `${workspaceId}:${sessionId}`,
      replay: { maxEventsPerRun: 2, retentionMs: 60_000 },
    });
    const runStreams = new ControlPlaneChatSessionRunStreamController({ eventBus, runService });
    const address = { workspaceId: 'workspace-1', sessionId: 'session-1' };
    const workspaceEvents: ControlPlaneSessionsEventEnvelope[] = [];
    eventBus.on(ControlPlaneChatSessionEventsController.workspaceAddressKey(address), (event) => {
      workspaceEvents.push(event as ControlPlaneSessionsEventEnvelope);
    });

    await runService.startAndWait({
      address,
      ...runStreams.createLifecycle(address),
      execute: async (run) => {
        [1, 2, 3].forEach((step) => run.publishActivity({
          source: 'agent-loop',
          type: 'assistant.stream',
          runId: run.runId,
          step,
          text: `chunk ${step}`,
          done: false,
          timestamp: new Date().toISOString(),
        }));
        return { outcome: 'done', summary: 'Finished.', internal: 'not public' };
      },
    });

    await vi.waitFor(() => {
      expect(workspaceEvents.some((event) => event.type === 'session.run.terminal')).toBe(true);
    });
    expect(workspaceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session.run.updated', status: 'started' }),
      expect.objectContaining({
        type: 'session.run.terminal',
        terminal: expect.objectContaining({
          kind: 'result',
          sequence: 4,
          result: { outcome: 'done', summary: 'Finished.' },
        }),
      }),
      expect.objectContaining({ type: 'session.run.updated', status: 'settled' }),
    ]));
  });
});

async function nextSessionListEvent(
  events: AsyncGenerator<ControlPlaneSessionsEventEnvelope>,
  predicate: (event: ControlPlaneSessionsEventEnvelope) => boolean = () => true,
): Promise<IteratorResult<ControlPlaneSessionsEventEnvelope>> {
  return await Promise.race([
    readUntilSessionListEvent(events, predicate),
    new Promise<IteratorResult<ControlPlaneSessionsEventEnvelope>>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for sessions.updated')), 1000);
    }),
  ]);
}

async function readUntilSessionListEvent(
  events: AsyncGenerator<ControlPlaneSessionsEventEnvelope>,
  predicate: (event: ControlPlaneSessionsEventEnvelope) => boolean,
): Promise<IteratorResult<ControlPlaneSessionsEventEnvelope>> {
  while (true) {
    const next = await events.next();
    if (next.done || predicate(next.value)) {
      return next;
    }
  }
}

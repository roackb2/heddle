import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControlPlaneChatSessionEventsController } from '@/server/controllers/trpc/control-plane/chat-session-events.js';
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

  it('emits workspace-scoped session activity events', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-session-list-events-'));
    mkdirSync(stateRoot, { recursive: true });

    const controller = new ControlPlaneChatSessionsController();
    const abort = new AbortController();
    const events = controller.subscribeSessionListEvents({
      workspaceId: 'workspace-1',
      stateRoot,
      signal: abort.signal,
    });
    const next = nextSessionListEvent(events, (event) => event.type === 'session.event');

    ControlPlaneChatSessionEventsController.emitSessionActivities({
      eventBus: Reflect.get(controller, 'sessionEventBus'),
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      activities: [{
        source: 'agent-loop',
        type: 'loop.finished',
        runId: 'run-1',
        outcome: 'done',
        summary: 'Done.',
        timestamp: '2026-06-12T00:00:00.000Z',
      }],
    });

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        type: 'session.event',
        sessionId: 'session-1',
      },
    });

    abort.abort();
    await events.return(undefined);
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

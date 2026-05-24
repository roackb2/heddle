import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControlPlaneChatSessionsController } from '@/server/features/control-plane/controllers/chat-sessions-controller.js';
import type { ControlPlaneSessionsEventEnvelope } from '@/server/features/control-plane/types.js';

describe('ControlPlaneChatSessionsController session list events', () => {
  it('emits a sessions.updated event when the session catalog changes', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-session-list-events-'));
    mkdirSync(stateRoot, { recursive: true });
    const catalogPath = join(stateRoot, 'chat-sessions.catalog.json');
    writeFileSync(catalogPath, JSON.stringify({ version: 1, sessions: [] }));

    const controller = new ControlPlaneChatSessionsController();
    const abort = new AbortController();
    const events = controller.subscribeSessionListEvents({
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
});

async function nextSessionListEvent(
  events: AsyncGenerator<ControlPlaneSessionsEventEnvelope>,
): Promise<IteratorResult<ControlPlaneSessionsEventEnvelope>> {
  return await Promise.race([
    events.next(),
    new Promise<IteratorResult<ControlPlaneSessionsEventEnvelope>>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for sessions.updated')), 1000);
    }),
  ]);
}

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ChatSessionLeaseLostError,
  ChatSessionLeases,
  type ChatSessionLeaseOwner,
} from '../../../core/chat/engine/sessions/leases/index.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';
import { FileConversationSessionService } from '../../../core/chat/engine/sessions/service.js';

const ownerA: ChatSessionLeaseOwner = {
  ownerKind: 'daemon',
  hostId: 'host-a',
  ownerId: 'daemon-runtime-a',
  clientLabel: 'control plane A',
};
const ownerB: ChatSessionLeaseOwner = {
  ownerKind: 'daemon',
  hostId: 'host-b',
  ownerId: 'daemon-runtime-b',
  clientLabel: 'control plane B',
};

describe('chat session lease service', () => {
  it('allows only one winner when an expired owner renewal races a takeover', async () => {
    const fixture = createFixture();
    const session = await fixture.serviceA.create({ id: 'session-1', name: 'Session 1' });
    await fixture.serviceA.acquireLease(session.id, ownerA);
    await expireLease(fixture.repository, session.id);

    const results = await Promise.allSettled([
      fixture.serviceA.refreshLease(session.id, ownerA),
      fixture.serviceB.acquireLease(session.id, ownerB),
    ]);

    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');

    const persisted = await fixture.serviceA.require(session.id);
    expect(persisted.lease).toMatchObject({
      hostId: ownerB.hostId,
      ownerId: ownerB.ownerId,
      fencingToken: 2,
    });
  });

  it('rejects an expired owner write before another host takes over', async () => {
    const fixture = createFixture();
    const session = await fixture.serviceA.create({ id: 'session-1', name: 'Session 1' });
    const leased = await fixture.serviceA.acquireLease(session.id, ownerA);
    const claim = ChatSessionLeases.claim(leased);
    await expireLease(fixture.repository, session.id);

    await expect(fixture.serviceA.updateWithLease(session.id, claim, (current) => ({
      ...current,
      name: 'stale mutation',
    }))).rejects.toBeInstanceOf(ChatSessionLeaseLostError);

    expect((await fixture.serviceA.require(session.id)).name).toBe('Session 1');
  });

  it('rejects a stale owner commit after reassignment to another host', async () => {
    const fixture = createFixture();
    const session = await fixture.serviceA.create({ id: 'session-1', name: 'Session 1' });
    const firstLease = await fixture.serviceA.acquireLease(session.id, ownerA);
    const staleClaim = ChatSessionLeases.claim(firstLease);
    await expireLease(fixture.repository, session.id);

    const reassigned = await fixture.serviceB.acquireLease(session.id, ownerB);
    expect(reassigned.lease?.fencingToken).toBe(staleClaim.fencingToken + 1);

    await expect(fixture.serviceA.updateWithLease(session.id, staleClaim, (current) => ({
      ...current,
      name: 'stale mutation',
    }))).rejects.toBeInstanceOf(ChatSessionLeaseLostError);

    const persisted = await fixture.serviceB.require(session.id);
    expect(persisted.name).toBe('Session 1');
    expect(persisted.lease).toMatchObject({
      hostId: ownerB.hostId,
      ownerId: ownerB.ownerId,
      fencingToken: staleClaim.fencingToken + 1,
    });
  });
});

function createFixture(): {
  repository: FileChatSessionRepository;
  serviceA: FileConversationSessionService;
  serviceB: FileConversationSessionService;
} {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-lease-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
  const createService = () => new FileConversationSessionService({
    workspaceRoot,
    stateRoot,
    sessionStoragePath,
    model: 'gpt-5.4',
  });

  return {
    repository: new FileChatSessionRepository({ sessionStoragePath }),
    serviceA: createService(),
    serviceB: createService(),
  };
}

async function expireLease(
  repository: FileChatSessionRepository,
  sessionId: string,
): Promise<void> {
  const stored = await repository.read(sessionId);
  if (!stored?.session.lease) {
    throw new Error(`Expected session ${sessionId} to have a lease.`);
  }

  await repository.update({
    session: {
      ...stored.session,
      lease: {
        ...stored.session.lease,
        lastSeenAt: '1970-01-01T00:00:00.000Z',
      },
    },
    expectedRevision: stored.revision,
  });
}

import { describe, expect, it } from 'vitest';
import {
  ChatSessionLeases,
  SESSION_LEASE_STALE_AFTER_MS,
} from '../../../core/chat/engine/sessions/leases/index.js';
import type { ChatSession } from '../../../core/chat/types.js';

const acquiredAt = Date.parse('2026-04-21T01:00:00.000Z');
const owner = {
  ownerKind: 'tui' as const,
  hostId: 'host-a',
  ownerId: 'tui-runtime-1',
  clientLabel: 'terminal chat',
};

function createSession(): ChatSession {
  return {
    id: 'session-1',
    name: 'Session 1',
    history: [],
    messages: [],
    turns: [],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    archives: [],
  };
}

describe('chat session leases', () => {
  it('acquires a fenced lease and preserves its epoch after release', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });
    const claim = ChatSessionLeases.claim(leased);

    expect(leased).toMatchObject({
      leaseEpoch: 1,
      lease: {
        ownerKind: 'tui',
        hostId: 'host-a',
        ownerId: 'tui-runtime-1',
        fencingToken: 1,
        clientLabel: 'terminal chat',
      },
    });
    expect(ChatSessionLeases.isHeld(leased, claim, { now: acquiredAt + 1 })).toBe(true);

    const released = ChatSessionLeases.release(leased, owner);
    expect(released.lease).toBeUndefined();
    expect(released.leaseEpoch).toBe(1);

    const reacquired = ChatSessionLeases.acquire(released, {
      ...owner,
      ownerId: 'tui-runtime-2',
    }, { now: acquiredAt + 1 });
    expect(reacquired.lease?.fencingToken).toBe(2);
    expect(reacquired.leaseEpoch).toBe(2);
  });

  it('refreshes the matching owner without changing its fence or acquisition time', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });
    const refreshed = ChatSessionLeases.refresh(leased, owner, { now: acquiredAt + 5_000 });

    expect(refreshed.lease).toMatchObject({
      acquiredAt: '2026-04-21T01:00:00.000Z',
      lastSeenAt: '2026-04-21T01:00:05.000Z',
      fencingToken: 1,
    });
    expect(ChatSessionLeases.claim(refreshed)).toEqual(ChatSessionLeases.claim(leased));
  });

  it('does not equate identical process-local owner IDs on different hosts', () => {
    const leased = ChatSessionLeases.acquire(createSession(), {
      ...owner,
      ownerId: 'daemon-4686',
    }, { now: acquiredAt });
    const collidingOwner = {
      ...owner,
      hostId: 'host-b',
      ownerId: 'daemon-4686',
    };

    expect(ChatSessionLeases.isSameOwner(leased.lease, collidingOwner)).toBe(false);
    expect(ChatSessionLeases.conflict(leased, collidingOwner, { now: acquiredAt + 1_000 }))
      .toContain('already active in terminal chat');
  });

  it('does not infer lease liveness from a reused PID on the same host', () => {
    const leased = ChatSessionLeases.acquire(createSession(), {
      ...owner,
      ownerId: 'daemon-4686-runtime-a',
    }, { now: acquiredAt });
    const restartedOwner = {
      ...owner,
      ownerId: 'daemon-4686-runtime-b',
    };

    expect(ChatSessionLeases.conflict(leased, restartedOwner, { now: acquiredAt + 1_000 }))
      .toContain('already active in terminal chat');
  });

  it('allows stale takeover and invalidates the previous owner claim', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });
    const previousClaim = ChatSessionLeases.claim(leased);
    const takeoverAt = acquiredAt + SESSION_LEASE_STALE_AFTER_MS + 1;
    const replacement = {
      ownerKind: 'daemon' as const,
      hostId: 'host-b',
      ownerId: 'daemon-runtime-1',
      clientLabel: 'control plane',
    };

    expect(ChatSessionLeases.conflict(leased, replacement, { now: takeoverAt })).toBeUndefined();
    const reassigned = ChatSessionLeases.acquire(leased, replacement, { now: takeoverAt });

    expect(reassigned.lease?.fencingToken).toBe(2);
    expect(ChatSessionLeases.isHeld(reassigned, previousClaim, { now: takeoverAt })).toBe(false);
    expect(ChatSessionLeases.isHeld(
      reassigned,
      ChatSessionLeases.claim(reassigned),
      { now: takeoverAt },
    )).toBe(true);
  });

  it('reacquires an expired lease for the same owner with a new fence', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });
    const reacquired = ChatSessionLeases.acquire(leased, owner, {
      now: acquiredAt + SESSION_LEASE_STALE_AFTER_MS + 1,
    });

    expect(reacquired.lease?.fencingToken).toBe(2);
    expect(reacquired.lease?.acquiredAt).not.toBe(leased.lease?.acquiredAt);
    expect(ChatSessionLeases.isHeld(
      reacquired,
      ChatSessionLeases.claim(leased),
      { now: acquiredAt + SESSION_LEASE_STALE_AFTER_MS + 1 },
    )).toBe(false);
  });

  it('treats an expired lease as lost even before another owner takes it over', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });

    expect(ChatSessionLeases.isHeld(
      leased,
      ChatSessionLeases.claim(leased),
      { now: acquiredAt + SESSION_LEASE_STALE_AFTER_MS + 1 },
    )).toBe(false);
  });

  it('does not refresh an expired lease', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });
    const refreshed = ChatSessionLeases.refresh(leased, owner, {
      now: acquiredAt + SESSION_LEASE_STALE_AFTER_MS + 1,
    });

    expect(refreshed).toEqual(leased);
  });

  it('ignores release requests from a different host or runtime', () => {
    const leased = ChatSessionLeases.acquire(createSession(), owner, { now: acquiredAt });

    expect(ChatSessionLeases.release(leased, {
      hostId: 'host-b',
      ownerId: owner.ownerId,
    })).toEqual(leased);
    expect(ChatSessionLeases.release(leased, {
      hostId: owner.hostId,
      ownerId: 'tui-runtime-2',
    })).toEqual(leased);
  });
});

import { describe, expect, it } from 'vitest';
import {
  acquireSessionLease,
  getSessionLeaseConflict,
  isSessionLeaseFresh,
  isSessionLeaseOwnedByDeadLocalProcess,
  releaseSessionLease,
} from '../../core/chat/session-lease.js';
import type { ChatSession } from '../../core/chat/types.js';

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
  it('acquires and releases a lease for the same owner', () => {
    const leased = acquireSessionLease(createSession(), {
      ownerKind: 'tui',
      ownerId: 'tui-123',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:00:00.000Z'),
    });

    expect(leased.lease).toMatchObject({
      ownerKind: 'tui',
      ownerId: 'tui-123',
      clientLabel: 'terminal chat',
    });
    expect(isSessionLeaseFresh(leased.lease, { now: Date.parse('2026-04-21T01:05:00.000Z') })).toBe(true);

    const released = releaseSessionLease(leased, { ownerId: 'tui-123' });
    expect(released.lease).toBeUndefined();
  });

  it('reports a conflict for a different fresh owner', () => {
    const leased = acquireSessionLease(createSession(), {
      ownerKind: 'daemon',
      ownerId: 'daemon-1',
      clientLabel: 'control plane',
    }, {
      now: Date.parse('2026-04-21T01:00:00.000Z'),
    });

    expect(getSessionLeaseConflict(leased, {
      ownerKind: 'tui',
      ownerId: 'tui-123',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:01:00.000Z'),
    })).toContain('Continuing from multiple clients in the same session may corrupt the conversation.');
  });

  it('ignores stale leases', () => {
    const leased = acquireSessionLease(createSession(), {
      ownerKind: 'ask',
      ownerId: 'ask-123',
      clientLabel: 'heddle ask',
    }, {
      now: Date.parse('2026-04-21T01:00:00.000Z'),
    });

    expect(getSessionLeaseConflict(leased, {
      ownerKind: 'tui',
      ownerId: 'tui-123',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:20:00.000Z'),
    })).toBeUndefined();
  });

  it('ignores fresh leases owned by dead local Heddle processes', () => {
    const leased = acquireSessionLease(createSession(), {
      ownerKind: 'tui',
      ownerId: 'tui-4686',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:00:00.000Z'),
    });

    expect(isSessionLeaseOwnedByDeadLocalProcess(leased.lease, { isProcessAlive: () => false })).toBe(true);
    expect(getSessionLeaseConflict(leased, {
      ownerKind: 'tui',
      ownerId: 'tui-123',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:01:00.000Z'),
      isProcessAlive: () => false,
    })).toBeUndefined();
  });

  it('still reports fresh local process leases when the owner is alive', () => {
    const leased = acquireSessionLease(createSession(), {
      ownerKind: 'tui',
      ownerId: 'tui-4686',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:00:00.000Z'),
    });

    expect(getSessionLeaseConflict(leased, {
      ownerKind: 'tui',
      ownerId: 'tui-123',
      clientLabel: 'terminal chat',
    }, {
      now: Date.parse('2026-04-21T01:01:00.000Z'),
      isProcessAlive: () => true,
    })).toContain('already active in terminal chat');
  });
});

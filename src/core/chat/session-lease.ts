import type { ChatSession, ChatSessionLease } from './types.js';

const DEFAULT_SESSION_LEASE_STALE_AFTER_MS = 15 * 60 * 1000;

export type ChatSessionLeaseOwner = {
  ownerKind: ChatSessionLease['ownerKind'];
  ownerId: string;
  clientLabel?: string;
};

export function isSessionLeaseFresh(
  lease: ChatSessionLease | undefined,
  options?: { now?: number; staleAfterMs?: number },
): boolean {
  if (!lease) {
    return false;
  }

  const lastSeenAt = Date.parse(lease.lastSeenAt);
  if (!Number.isFinite(lastSeenAt)) {
    return false;
  }

  return (options?.now ?? Date.now()) - lastSeenAt <= (options?.staleAfterMs ?? DEFAULT_SESSION_LEASE_STALE_AFTER_MS);
}

export function acquireSessionLease(
  session: ChatSession,
  owner: ChatSessionLeaseOwner,
  options?: { now?: number },
): ChatSession {
  const timestamp = new Date(options?.now ?? Date.now()).toISOString();
  return {
    ...session,
    lease: {
      ownerKind: owner.ownerKind,
      ownerId: owner.ownerId,
      acquiredAt: session.lease?.ownerId === owner.ownerId ? session.lease.acquiredAt : timestamp,
      lastSeenAt: timestamp,
      clientLabel: owner.clientLabel,
    },
  };
}

export function releaseSessionLease(session: ChatSession, owner?: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession {
  if (!session.lease || (owner && session.lease.ownerId !== owner.ownerId)) {
    return session;
  }

  return {
    ...session,
    lease: undefined,
  };
}

export function getSessionLeaseConflict(
  session: ChatSession,
  owner: ChatSessionLeaseOwner,
  options?: { now?: number; staleAfterMs?: number },
): string | undefined {
  if (!session.lease || session.lease.ownerId === owner.ownerId || !isSessionLeaseFresh(session.lease, options)) {
    return undefined;
  }

  return [
    `Session ${session.id} is already active in ${session.lease.clientLabel ?? `${session.lease.ownerKind} (${session.lease.ownerId})`}.`,
    'Continuing from multiple clients in the same session may corrupt the conversation.',
    'Wait for the other client to finish or use a different session.',
  ].join(' ');
}

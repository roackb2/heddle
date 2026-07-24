/**
 * Pure chat-session lease policy.
 *
 * Keep lease freshness, ownership, acquisition, release, and conflict messages
 * here. This class should not perform storage I/O; callers persist the returned
 * session through the owning service or repository.
 */
import type { ChatSession, ChatSessionLease } from '@/core/chat/types.js';
import type {
  ChatSessionLeaseClaim,
  ChatSessionLeaseConflictOptions,
  ChatSessionLeaseIdentity,
  ChatSessionLeaseOwner,
} from './types.js';
import dayjs from 'dayjs';

export const SESSION_LEASE_REFRESH_INTERVAL_MS = 5 * 1000;
export const SESSION_LEASE_STALE_AFTER_MS = 20 * 1000;

export class ChatSessionLeases {
  static isFresh(
    lease: ChatSessionLease | undefined,
    options?: { now?: number; staleAfterMs?: number },
  ): boolean {
    if (!lease) {
      return false;
    }

    const lastSeenAt = dayjs(lease.lastSeenAt);
    if (!lastSeenAt.isValid()) {
      return false;
    }

    return dayjs(options?.now ?? Date.now()).diff(lastSeenAt) <= (options?.staleAfterMs ?? SESSION_LEASE_STALE_AFTER_MS);
  }

  static isSameOwner(
    lease: ChatSessionLease | undefined,
    owner: ChatSessionLeaseIdentity,
  ): boolean {
    return lease?.hostId === owner.hostId && lease.ownerId === owner.ownerId;
  }

  static claim(session: Pick<ChatSession, 'id' | 'lease'>): ChatSessionLeaseClaim {
    const lease = session.lease;
    if (!lease?.hostId) {
      throw new Error(`Session ${session.id} does not have a fenced lease.`);
    }

    return {
      hostId: lease.hostId,
      ownerId: lease.ownerId,
      fencingToken: lease.fencingToken,
    };
  }

  static isHeld(
    session: Pick<ChatSession, 'lease'>,
    claim: ChatSessionLeaseClaim,
    options?: { now?: number; staleAfterMs?: number },
  ): boolean {
    return ChatSessionLeases.isFresh(session.lease, options)
      && ChatSessionLeases.isSameOwner(session.lease, claim)
      && session.lease?.fencingToken === claim.fencingToken;
  }

  static acquire(
    session: ChatSession,
    owner: ChatSessionLeaseOwner,
    options?: { now?: number },
  ): ChatSession {
    const timestamp = dayjs(options?.now ?? Date.now()).toISOString();
    const continuingOwner = ChatSessionLeases.isSameOwner(session.lease, owner)
      && ChatSessionLeases.isFresh(session.lease, options);
    const currentToken = Math.max(session.leaseEpoch ?? 0, session.lease?.fencingToken ?? 0);
    const fencingToken = continuingOwner ? session.lease?.fencingToken ?? currentToken + 1 : currentToken + 1;
    return {
      ...session,
      leaseEpoch: Math.max(currentToken, fencingToken),
      lease: {
        ownerKind: owner.ownerKind,
        hostId: owner.hostId,
        ownerId: owner.ownerId,
        fencingToken,
        acquiredAt: continuingOwner ? session.lease?.acquiredAt ?? timestamp : timestamp,
        lastSeenAt: timestamp,
        clientLabel: owner.clientLabel,
      },
    };
  }

  static refresh(
    session: ChatSession,
    owner: ChatSessionLeaseIdentity,
    options?: { now?: number },
  ): ChatSession {
    const lease = session.lease;
    if (
      !lease
      || !ChatSessionLeases.isSameOwner(lease, owner)
      || !ChatSessionLeases.isFresh(lease, options)
    ) {
      return session;
    }

    return {
      ...session,
      lease: {
        ...lease,
        lastSeenAt: dayjs(options?.now ?? Date.now()).toISOString(),
      },
    };
  }

  static release(session: ChatSession, owner?: ChatSessionLeaseIdentity): ChatSession {
    if (!session.lease || (owner && !ChatSessionLeases.isSameOwner(session.lease, owner))) {
      return session;
    }

    return {
      ...session,
      lease: undefined,
    };
  }

  static conflict(
    session: ChatSession,
    owner: ChatSessionLeaseOwner,
    options?: ChatSessionLeaseConflictOptions,
  ): string | undefined {
    if (
      !session.lease ||
      ChatSessionLeases.isSameOwner(session.lease, owner) ||
      !ChatSessionLeases.isFresh(session.lease, options)
    ) {
      return undefined;
    }

    return [
      `Session ${session.id} is already active in ${session.lease.clientLabel ?? `${session.lease.ownerKind} (${session.lease.ownerId})`}.`,
      'Continuing from multiple clients in the same session may corrupt the conversation.',
      'Wait for the other client to finish or use a different session.',
    ].join(' ');
  }
}

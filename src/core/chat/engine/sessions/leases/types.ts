import type { ChatSessionLease } from '@/core/chat/types.js';

export type ChatSessionLeaseOwner = {
  ownerKind: ChatSessionLease['ownerKind'];
  /**
   * Stable host or replica identity. It prevents equal process-local owner IDs
   * on different machines from being treated as the same lease holder.
   */
  hostId: string;
  /** Globally unique identity for one runtime instance on this host. */
  ownerId: string;
  clientLabel?: string;
};

export type ChatSessionLeaseIdentity = Pick<ChatSessionLeaseOwner, 'hostId' | 'ownerId'>;

export type ChatSessionLeaseClaim = ChatSessionLeaseIdentity & {
  fencingToken: number;
};

export type ChatSessionLeaseConflictOptions = {
  now?: number;
  staleAfterMs?: number;
};

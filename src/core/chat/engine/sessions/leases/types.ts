import type { ChatSessionLease } from '../../../types.js';

export type ChatSessionLeaseOwner = {
  ownerKind: ChatSessionLease['ownerKind'];
  ownerId: string;
  clientLabel?: string;
};

export type ChatSessionLeaseConflictOptions = {
  now?: number;
  staleAfterMs?: number;
  isProcessAlive?: (pid: number) => boolean;
};

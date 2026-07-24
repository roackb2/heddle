import type { ChatSessionLease, ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseClaim, ChatSessionLeaseIdentity } from './types.js';

export class ChatSessionLeaseLostError extends Error {
  readonly sessionId: string;
  readonly expected: ChatSessionLeaseClaim | ChatSessionLeaseIdentity;
  readonly actual?: ChatSessionLease;

  constructor(args: {
    session: Pick<ChatSession, 'id' | 'lease'>;
    expected: ChatSessionLeaseClaim | ChatSessionLeaseIdentity;
  }) {
    const fence = 'fencingToken' in args.expected
      ? ` at fence ${args.expected.fencingToken}`
      : '';
    super(
      `Session ${args.session.id} lease is no longer held by `
      + `${args.expected.hostId}/${args.expected.ownerId}${fence}.`,
    );
    this.name = 'ChatSessionLeaseLostError';
    this.sessionId = args.session.id;
    this.expected = args.expected;
    this.actual = args.session.lease;
  }
}

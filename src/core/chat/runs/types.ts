import type {
  ToolApprovalRequest,
  ToolApprovalUserDecision,
} from '@/core/approvals/index.js';
import type {
  ConversationEngine,
  ContinueConversationTurnInput,
  SubmitConversationTurnInput,
  SubmitConversationTurnResult,
} from '@/core/chat/engine/types.js';
import type { ConversationActivity } from '@/core/live/index.js';

export type ConversationRunAddress = {
  scopeId: string;
  sessionId: string;
};

export type ConversationRunReplayOptions = {
  maxEventsPerRun?: number;
  retentionMs?: number;
};

export type ConversationRunServiceOptions<Address extends { sessionId: string }> = {
  addressKey?: (address: Address) => string;
  replay?: ConversationRunReplayOptions;
  createRunId?: () => string;
  now?: () => Date;
  heartbeatIntervalMs?: number;
};

export type PendingConversationRunApproval = {
  approval: ToolApprovalRequest;
  resolve: (decision: ToolApprovalUserDecision) => void;
};

export type ConversationRunContext = {
  runId: string;
  acceptedAt: string;
  controller: AbortController;
  publishActivity(activity: ConversationActivity): void;
};

export type StartConversationRunInput<Address extends { sessionId: string }, Result> = {
  address: Address;
  onAccepted?: (run: ConversationRunContext) => void;
  onHeartbeat?: (run: ConversationRunContext) => void | Promise<void>;
  execute: (run: ConversationRunContext) => Promise<Result>;
  onError?: (error: unknown, run: ConversationRunContext) => void | Promise<void>;
  onSettled?: (run: ConversationRunContext) => void | Promise<void>;
};

export type ConversationRunAccepted<Address extends { sessionId: string }> = Address & {
  accepted: true;
  runId: string;
  acceptedAt: string;
};

type ConversationRunStreamEnvelope = {
  runId: string;
  sequence: number;
  timestamp: string;
};

export type ConversationRunStreamItem<Result> =
  | (ConversationRunStreamEnvelope & {
    kind: 'activity';
    activity: ConversationActivity;
  })
  | (ConversationRunStreamEnvelope & {
    kind: 'result';
    result: Result;
  })
  | (ConversationRunStreamEnvelope & {
    kind: 'cancelled';
    reason: string;
  })
  | (ConversationRunStreamEnvelope & {
    kind: 'error';
    error: {
      code: 'run_failed';
      message: string;
    };
  });

export type SubscribeConversationRunInput<Address extends { sessionId: string }> = {
  address: Address;
  runId: string;
  afterSequence?: number;
  signal?: AbortSignal;
};

export type StartConversationTurnRunInput<Address extends { sessionId: string }> = {
  address: Address;
  engine: ConversationEngine;
  turn: SubmitConversationTurnInput;
  onAccepted?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onAccepted'];
  onHeartbeat?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onHeartbeat'];
  onError?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onError'];
  onSettled?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onSettled'];
};

export type StartConversationContinueRunInput<Address extends { sessionId: string }> = {
  address: Address;
  engine: ConversationEngine;
  turn: ContinueConversationTurnInput;
  onAccepted?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onAccepted'];
  onHeartbeat?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onHeartbeat'];
  onError?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onError'];
  onSettled?: StartConversationRunInput<Address, SubmitConversationTurnResult>['onSettled'];
};

export type ConversationRunHandle<Address extends { sessionId: string }, Result> =
  ConversationRunAccepted<Address> & {
    result: Promise<Result>;
    events(options?: { afterSequence?: number; signal?: AbortSignal }): AsyncIterable<ConversationRunStreamItem<Result>>;
    cancel(): boolean;
    resolveApproval(decision: ToolApprovalUserDecision): boolean;
  };

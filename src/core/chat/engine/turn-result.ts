import type { RuntimeArtifact } from '@/core/artifacts/index.js';
import type { RunFailure, ToolCall, ToolResult } from '@/core/types.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { DelegationRootScopeSnapshot } from '@/core/delegation/index.js';

export type ConversationTurnToolResult = {
  call: ToolCall;
  result: ToolResult;
  durationMs?: number;
  step: number;
  timestamp: string;
};

export type ConversationTurnResultSummary = {
  outcome: string;
  summary: string;
  failure?: RunFailure;
  session: ChatSession;
  traceFile?: string;
  artifacts: RuntimeArtifact[];
  toolResults: ConversationTurnToolResult[];
  /** In-memory child-run evidence for this turn. Omitted when delegation was off. */
  delegation?: DelegationRootScopeSnapshot;
  memory: {
    /**
     * Whether this turn changed Heddle's portable memory working copy.
     * The turn result resolves only after configured memory maintenance reaches
     * a stable boundary, so checkpointing callers may act on this value.
     */
    changed: boolean;
  };
};

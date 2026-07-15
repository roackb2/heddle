import type { LlmAdapter } from '@/core/llm/types.js';
import type { AgentLoopResult } from '@/core/runtime/loop/index.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';

export type RunInlineTurnMemoryMaintenanceArgs = {
  memoryRoot: string;
  llm: LlmAdapter;
  source: string;
  result: AgentLoopResult;
  onEvent?: (event: AgentLoopEvent) => void;
};

export type ScheduleBackgroundTurnMemoryMaintenanceArgs = {
  memoryRoot: string;
  llm: LlmAdapter;
  source: string;
  trace: AgentLoopResult['trace'];
  traceFile: string;
  sessionService: ConversationSessionService;
  sessionId: string;
  runId: string;
  onEvent?: (event: AgentLoopEvent) => void;
};

export type RunMemoryMaintenanceCoreArgs = Pick<
  RunInlineTurnMemoryMaintenanceArgs,
  'memoryRoot' | 'llm' | 'source'
> & {
  trace: AgentLoopResult['trace'];
};

export type TurnMemoryMaintenanceRuntimeInput = Pick<
  RunInlineTurnMemoryMaintenanceArgs,
  'memoryRoot' | 'llm' | 'source' | 'onEvent'
>;

export type AppendTurnMemoryMaintenanceEventsArgs = Pick<
  ScheduleBackgroundTurnMemoryMaintenanceArgs,
  'traceFile' | 'sessionService' | 'sessionId'
> & {
  events: AgentLoopResult['trace'];
};

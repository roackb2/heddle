import type { ToolCall, ToolDefinition } from '../../index.js';
import type { ToolApprovalPolicy } from '../approvals/types.js';
import type { TraceSummarizerRegistry } from '../observability/trace-summarizers.js';
import { executeOrdinaryChatTurn, clearOrdinaryChatTurnLease } from './ordinary-turn.js';
import type { ChatSessionLeaseOwner } from './session-lease.js';
import type { AgentLoopEvent } from '../../index.js';

export type SubmitChatSessionPromptArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  preferApiKey?: boolean;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  onEvent?: (event: AgentLoopEvent) => void;
  onCompactionStatus?: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; summaryPath?: string; error?: string }) => void;
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export async function submitChatSessionPrompt(args: SubmitChatSessionPromptArgs) {
  const result = await executeOrdinaryChatTurn({
    workspaceRoot: args.workspaceRoot,
    stateRoot: args.stateRoot,
    sessionStoragePath: args.sessionStoragePath,
    sessionId: args.sessionId,
    prompt: args.prompt,
    apiKey: args.apiKey,
    preferApiKey: args.preferApiKey,
    systemContext: args.systemContext,
    memoryMaintenanceMode: args.memoryMaintenanceMode,
    approvalPolicies: args.approvalPolicies,
    traceSummarizerRegistry: args.traceSummarizerRegistry,
    host: {
      events: args.onEvent ? { onAgentLoopEvent: args.onEvent } : undefined,
      compaction: args.onCompactionStatus ? {
        onPreflightCompactionStatus: args.onCompactionStatus,
        onFinalCompactionStatus: args.onCompactionStatus,
      } : undefined,
      approvals: args.approveToolCall ? {
        requestToolApproval: ({ call, tool }) => args.approveToolCall?.(call, tool) ?? Promise.resolve({ approved: false, reason: 'Missing approval handler.' }),
      } : undefined,
    },
    abortSignal: args.abortSignal,
    leaseOwner: args.leaseOwner,
  });

  return result;
}

export const clearChatSessionLease = clearOrdinaryChatTurnLease;

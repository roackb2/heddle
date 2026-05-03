import type { ToolApprovalPolicy } from '../approvals/types.js';
import { runAgentLoop, type RunAgentLoopOptions } from '../runtime/agent-loop.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import type { ChatSession } from './types.js';
import type { ChatTurnHostPort } from './turn-host.js';
import type { ChatTurnRuntime } from './turn-runtime.js';

export type RunOrdinaryChatTurnLoopArgs = {
  prompt: string;
  workspaceRoot: string;
  stateRoot: string;
  runtime: ChatTurnRuntime;
  tools: ToolDefinition[];
  session: ChatSession;
  host?: ChatTurnHostPort;
  approvalPolicies?: ToolApprovalPolicy[];
  onAssistantStream?: RunAgentLoopOptions['onAssistantStream'];
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
  shouldStop?: RunAgentLoopOptions['shouldStop'];
  abortSignal?: AbortSignal;
};

export function runOrdinaryChatTurnLoop(args: RunOrdinaryChatTurnLoopArgs) {
  return runAgentLoop({
    goal: args.prompt,
    model: args.runtime.model,
    apiKey: args.runtime.apiKey,
    workspaceRoot: args.workspaceRoot,
    stateDir: args.stateRoot,
    memoryDir: args.runtime.memoryDir,
    llm: args.runtime.llm,
    tools: args.tools,
    includeDefaultTools: false,
    history: args.session.history,
    systemContext: args.runtime.systemContext,
    onAssistantStream: args.onAssistantStream,
    onTraceEvent: args.onTraceEvent,
    onEvent: args.host?.events?.onAgentLoopEvent,
    approvalPolicies: args.approvalPolicies,
    approveToolCall: createHostToolApprovalBridge(args.host),
    shouldStop: args.shouldStop,
    abortSignal: args.abortSignal,
  });
}

function createHostToolApprovalBridge(host: ChatTurnHostPort | undefined): RunAgentLoopOptions['approveToolCall'] {
  if (!host?.approvals?.requestToolApproval) {
    return undefined;
  }

  return (call: ToolCall, tool: ToolDefinition) => (
    host.approvals?.requestToolApproval?.({ call, tool }) ?? Promise.resolve({ approved: false, reason: 'Missing approval port.' })
  );
}

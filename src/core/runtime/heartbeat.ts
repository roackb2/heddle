import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { appendMemoryCatalogSystemContext } from '../memory/catalog.js';
import type { ChatMessage, LlmAdapter } from '../llm/types.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import { runAgentLoop } from './agent-loop.js';
import { createAgentLoopCheckpoint } from './events.js';
import type { AgentLoopCheckpoint, AgentLoopEvent, AgentLoopState } from './events.js';

const DEFAULT_HEARTBEAT_MAX_STEPS = 80;

export type HeartbeatDecision = 'continue' | 'pause' | 'complete' | 'escalate';

export type RunAgentHeartbeatOptions = {
  task: string;
  checkpoint?: AgentLoopState | AgentLoopCheckpoint;
  model?: string;
  apiKey?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  history?: ChatMessage[];
  llm?: LlmAdapter;
  tools?: ToolDefinition[];
  extraTools?: ToolDefinition[];
  includeDefaultTools?: boolean;
  includePlanTool?: boolean;
  logger?: Logger;
  onEvent?: (event: AgentLoopEvent) => void;
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
};

export type AgentHeartbeatResult = {
  decision: HeartbeatDecision;
  summary: string;
  checkpoint: AgentLoopCheckpoint;
  state: AgentLoopState;
};

export async function runAgentHeartbeat(options: RunAgentHeartbeatOptions): Promise<AgentHeartbeatResult> {
  const memoryDir = options.memoryDir ?? resolve(options.workspaceRoot ?? process.cwd(), options.stateDir ?? '.heddle', 'memory');
  const systemContext = appendHeartbeatSystemContext(appendMemoryCatalogSystemContext({
    systemContext: options.systemContext,
    memoryRoot: memoryDir,
  }));

  const result = await runAgentLoop({
    goal: buildHeartbeatGoal(options.task),
    model: options.model,
    apiKey: options.apiKey,
    maxSteps: options.maxSteps ?? DEFAULT_HEARTBEAT_MAX_STEPS,
    workspaceRoot: options.workspaceRoot,
    stateDir: options.stateDir,
    memoryDir,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext,
    history: options.history,
    resumeFrom: options.checkpoint,
    llm: options.llm,
    tools: options.tools,
    extraTools: options.extraTools,
    includeDefaultTools: options.includeDefaultTools,
    includePlanTool: options.includePlanTool,
    logger: options.logger,
    onEvent: options.onEvent,
    approveToolCall: options.approveToolCall,
    shouldStop: options.shouldStop,
    abortSignal: options.abortSignal,
  });

  const decision = inferHeartbeatDecision(result.summary, result.outcome);
  const runId = result.state.runId;
  const checkpoint = createAgentLoopCheckpoint(result.state);
  const now = () => new Date().toISOString();

  options.onEvent?.({
    type: 'heartbeat.decision',
    runId,
    decision,
    outcome: result.outcome,
    summary: result.summary,
    timestamp: now(),
  });

  if (decision === 'escalate') {
    options.onEvent?.({
      type: 'escalation.required',
      runId,
      task: options.task,
      outcome: result.outcome,
      summary: result.summary,
      step: result.trace.length,
      timestamp: now(),
    });
  }

  options.onEvent?.({
    type: 'checkpoint.saved',
    runId,
    checkpoint,
    step: result.trace.length,
    timestamp: now(),
  });

  return {
    decision,
    summary: result.summary,
    checkpoint,
    state: result.state,
  };
}

function buildHeartbeatGoal(task: string): string {
  return [
    'Heartbeat wake cycle.',
    '',
    'Durable task:',
    task,
    '',
    'Work autonomously on the task if there is useful, safe progress to make now.',
    'Do not wait for a chat message.',
    'If blocked, risky, or user input is required, escalate clearly instead of guessing.',
    '',
    'End your response with exactly one decision line:',
    'HEARTBEAT_DECISION: continue | pause | complete | escalate',
  ].join('\n');
}

function appendHeartbeatSystemContext(systemContext: string | undefined): string {
  const heartbeatContext = [
    '## Heartbeat Mode',
    '',
    'This run was started by an autonomous heartbeat, not by a live chat message.',
    'Operate within the available tools and approval policy.',
    'There may be no live approval handler. Prefer read-only tools and simple run_shell_inspect commands without cd, &&, redirects, or subshells.',
    'The shell already runs from the workspace root. For git inspection, use commands such as `git status -sb` directly instead of `cd <path> && git status`.',
    'Use memory-note tools for durable observations when useful.',
    'Make bounded useful progress, update durable memory when appropriate, and stop cleanly.',
    'Escalate only when human input, credentials, policy approval, or risky judgment is required.',
    'The required final decision line is: HEARTBEAT_DECISION: continue | pause | complete | escalate',
  ].join('\n');

  return systemContext ? `${systemContext}\n\n${heartbeatContext}` : heartbeatContext;
}

function inferHeartbeatDecision(summary: string, outcome: string): HeartbeatDecision {
  const match = summary.match(/HEARTBEAT_DECISION:\s*(continue|pause|complete|escalate)\b/i);
  if (match) {
    return match[1].toLowerCase() as HeartbeatDecision;
  }

  if (outcome === 'done') {
    return 'pause';
  }

  return 'escalate';
}

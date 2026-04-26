// ---------------------------------------------------------------------------
// Tool dispatch — approval, execution, fallback, and deduplication logic
// for the agent loop.
// ---------------------------------------------------------------------------

import { resolve } from 'node:path';
import type { ToolDefinition, ToolCall, TraceEvent } from '../types.js';
import type { RunAgentOptions } from './run-agent.js';
import { createToolRegistry } from '../tools/registry.js';
import { executeTool } from '../tools/execute-tool.js';
import { stableSerialize, normalizeToolInput, buildRepeatedToolCallResult } from './util.js';
import type { Logger } from 'pino';

const MAX_IDENTICAL_TOOL_CALLS = 2;

export async function maybeDenyToolCall(args: {
  call: ToolCall;
  tool: ToolDefinition | undefined;
  step: number;
  now: () => string;
  approveToolCall: RunAgentOptions['approveToolCall'];
  workspaceRoot?: string;
  record: (event: TraceEvent) => void;
  log: Logger;
}): Promise<{ ok: false; error: string } | undefined> {
  const { call, tool, step, now, approveToolCall, record, log } = args;
  if (!tool) {
    return undefined;
  }

  if (!requiresApprovalForCall(call, tool, args.workspaceRoot)) {
    return undefined;
  }

  const approval = await resolveToolApproval({ call, tool, step, now, approveToolCall, record });
  if (approval.approved) {
    return undefined;
  }

  const result = {
    ok: false as const,
    error:
      approval.reason ? `Approval denied for ${call.tool}: ${approval.reason}`
      : `Approval denied for ${call.tool}`,
  };
  log.warn({ step, tool: call.tool, reason: approval.reason }, 'Tool execution denied by approval policy');
  record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });
  return result;
}

export async function executeToolCallWithFallback(args: {
  call: ToolCall;
  step: number;
  now: () => string;
  registry: ReturnType<typeof createToolRegistry>;
  seenToolCalls: Map<string, number>;
  approveToolCall: RunAgentOptions['approveToolCall'];
  workspaceRoot?: string;
  record: (event: TraceEvent) => void;
  log: Logger;
}): Promise<{ effectiveCall: ToolCall; result: Awaited<ReturnType<typeof executeTool>> }> {
  const primary = await executeRecordedToolCall(args.call, args);
  const fallbackReason = getInspectFallbackReason(args.call, primary.result);
  if (!fallbackReason) {
    return primary;
  }

  const mutateTool = args.registry.get('run_shell_mutate');
  if (!mutateTool) {
    return primary;
  }

  const mutateCall: ToolCall = {
    id: `${args.call.id}-mutate-fallback`,
    tool: 'run_shell_mutate',
    input: args.call.input,
  };
  args.record({
    type: 'tool.fallback',
    fromCall: args.call,
    toCall: mutateCall,
    reason: fallbackReason,
    step: args.step,
    timestamp: args.now(),
  });
  const approvalDeniedResult = await maybeDenyToolCall({
    call: mutateCall,
    tool: mutateTool,
    step: args.step,
    now: args.now,
    approveToolCall: args.approveToolCall,
    workspaceRoot: args.workspaceRoot,
    record: args.record,
    log: args.log,
  });
  if (approvalDeniedResult) {
    return { effectiveCall: mutateCall, result: approvalDeniedResult };
  }

  args.log.info(
    { step: args.step, from: args.call.tool, to: mutateCall.tool, reason: fallbackReason },
    'Retrying inspect failure through mutate fallback',
  );
  return executeRecordedToolCall(mutateCall, args);
}

async function executeRecordedToolCall(
  call: ToolCall,
  args: {
    step: number;
    now: () => string;
    registry: ReturnType<typeof createToolRegistry>;
    seenToolCalls: Map<string, number>;
    record: (event: TraceEvent) => void;
    log: Logger;
  },
): Promise<{ effectiveCall: ToolCall; result: Awaited<ReturnType<typeof executeTool>> }> {
  const { step, now, registry, seenToolCalls, record, log } = args;
  log.info({ step, tool: call.tool }, 'Executing tool');
  record({ type: 'tool.call', call, step, timestamp: now() });

  const signature = `${call.tool}:${stableSerialize(normalizeToolInput(call.tool, call.input))}`;
  const seenCount = seenToolCalls.get(signature) ?? 0;
  const result = seenCount >= MAX_IDENTICAL_TOOL_CALLS
    ? buildRepeatedToolCallResult(call.tool)
    : await executeTool(registry, call);
  seenToolCalls.set(signature, seenCount + 1);
  log.debug({ step, tool: call.tool, ok: result.ok }, 'Tool result');
  record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });
  return { effectiveCall: call, result };
}

async function resolveToolApproval(args: {
  call: ToolCall;
  tool: ToolDefinition;
  step: number;
  now: () => string;
  approveToolCall: RunAgentOptions['approveToolCall'];
  record: (event: TraceEvent) => void;
}): Promise<{ approved: boolean; reason?: string }> {
  const { call, tool, step, now, approveToolCall, record } = args;
  record({ type: 'tool.approval_requested', call, step, timestamp: now() });
  const approval =
    approveToolCall ? await approveToolCall(call, tool)
    : {
        approved: false,
        reason: `No approval handler configured for ${call.tool}`,
      };
  record({
    type: 'tool.approval_resolved',
    call,
    approved: approval.approved,
    reason: approval.reason,
    step,
    timestamp: now(),
  });
  return approval;
}

function requiresApprovalForCall(call: ToolCall, tool: ToolDefinition, workspaceRoot?: string): boolean {
  if (tool.requiresApproval) {
    return true;
  }

  return isOutsideWorkspaceInspectionCall(call, workspaceRoot);
}

function isOutsideWorkspaceInspectionCall(call: ToolCall, workspaceRoot = process.cwd()): boolean {
  if (call.tool !== 'read_file' && call.tool !== 'list_files' && call.tool !== 'search_files' && call.tool !== 'edit_file') {
    return false;
  }

  const input = call.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  const rawPath = typeof record.path === 'string'
    ? record.path
    : call.tool === 'search_files' ? '.'
    : undefined;
  if (!rawPath) {
    return false;
  }

  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const resolvedTarget = resolve(resolvedWorkspaceRoot, rawPath);
  return resolvedTarget !== resolvedWorkspaceRoot && !resolvedTarget.startsWith(`${resolvedWorkspaceRoot}/`);
}

function getInspectFallbackReason(
  call: ToolCall,
  result: { ok: boolean; error?: string },
): string | undefined {
  if (call.tool !== 'run_shell_inspect' || result.ok) {
    return undefined;
  }

  return getInspectMutateFallbackReason(result.error);
}

function getInspectMutateFallbackReason(error: string | undefined): string | undefined {
  if (!error) {
    return undefined;
  }

  if (error.includes('run_shell_inspect policy')) {
    return 'inspect policy rejected the command';
  }

  if (error.includes('Inspect mode permits read-only pipes')) {
    return 'inspect shell restrictions rejected the command';
  }

  return undefined;
}

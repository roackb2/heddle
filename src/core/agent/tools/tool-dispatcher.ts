import type { Logger } from 'pino';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import { ToolApprovalPolicies, ToolApprovalService } from '@/core/approvals/index.js';
import { ToolExecutionService, type ToolRegistry } from '@/core/tools/index.js';
import type { ToolCall, ToolDefinition, TraceEvent } from '@/core/types.js';
import { normalizeToolInput, stableSerialize } from '@/core/agent/utils/index.js';
import type { RunAgentOptions } from '../types.js';

/**
 * Owns tool approval, execution, deduplication, and inspect-to-mutate fallback.
 *
 * ToolTurnService decides when tool calls are needed; this dispatcher owns how
 * a single call is authorized, executed, traced, and optionally retried.
 */
export class AgentToolDispatcher {
  static async maybeDenyToolCall(args: {
    call: ToolCall;
    tool: ToolDefinition | undefined;
    step: number;
    now: () => string;
    approvalPolicies?: ToolApprovalPolicy[];
    approveToolCall: RunAgentOptions['approveToolCall'];
    workspaceRoot?: string;
    record: (event: TraceEvent) => void;
    log: Logger;
  }): Promise<{ ok: false; error: string } | undefined> {
    const { call, tool, step, now, approveToolCall, record, log } = args;
    if (!tool) {
      return undefined;
    }

    const approval = await ToolApprovalService.resolve({
      policies: [...ToolApprovalPolicies.default(), ...(args.approvalPolicies ?? [])],
      context: {
        call,
        tool,
        workspaceRoot: args.workspaceRoot,
      },
      requestHumanApproval: approveToolCall ? async () => {
        record({ type: 'tool.approval_requested', call, step, timestamp: now() });
        const humanDecision = await approveToolCall(call, tool);
        record({
          type: 'tool.approval_resolved',
          call,
          approved: humanDecision.approved,
          reason: humanDecision.reason,
          step,
          timestamp: now(),
        });
        return humanDecision;
      } : undefined,
    });
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

  static async executeToolCallWithFallback(args: {
    call: ToolCall;
    step: number;
    now: () => string;
    registry: ToolRegistry;
    seenToolCalls: Map<string, number>;
    approvalPolicies?: ToolApprovalPolicy[];
    approveToolCall: RunAgentOptions['approveToolCall'];
    workspaceRoot?: string;
    record: (event: TraceEvent) => void;
    log: Logger;
  }): Promise<{ effectiveCall: ToolCall; result: Awaited<ReturnType<typeof ToolExecutionService.execute>> }> {
    const primary = await AgentToolDispatcher.executeRecordedToolCall(args.call, args);
    const fallbackReason = AgentToolDispatcher.getInspectFallbackReason(args.call, primary.result);
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
    const approvalDeniedResult = await AgentToolDispatcher.maybeDenyToolCall({
      call: mutateCall,
      tool: mutateTool,
      step: args.step,
      now: args.now,
      approveToolCall: args.approveToolCall,
      approvalPolicies: args.approvalPolicies,
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
    return AgentToolDispatcher.executeRecordedToolCall(mutateCall, args);
  }

  private static async executeRecordedToolCall(
    call: ToolCall,
    args: {
      step: number;
      now: () => string;
      registry: ToolRegistry;
      seenToolCalls: Map<string, number>;
      record: (event: TraceEvent) => void;
      log: Logger;
    },
  ): Promise<{ effectiveCall: ToolCall; result: Awaited<ReturnType<typeof ToolExecutionService.execute>> }> {
    const { step, now, registry, seenToolCalls, record, log } = args;
    log.info({ step, tool: call.tool }, 'Executing tool');
    record({ type: 'tool.call', call, step, timestamp: now() });

    const signature = `${call.tool}:${stableSerialize(normalizeToolInput(call.tool, call.input))}`;
    const seenCount = seenToolCalls.get(signature) ?? 0;
    if (seenCount >= 2) {
      log.warn(
        { step, tool: call.tool, repeatCount: seenCount + 1 },
        'Executing repeated identical tool call; warning only',
      );
    }

    const result = await ToolExecutionService.execute(registry, call);
    seenToolCalls.set(signature, seenCount + 1);
    log.debug({ step, tool: call.tool, ok: result.ok }, 'Tool result');
    record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });
    return { effectiveCall: call, result };
  }

  private static getInspectFallbackReason(
    call: ToolCall,
    result: { ok: boolean; error?: string },
  ): string | undefined {
    if (call.tool !== 'run_shell_inspect' || result.ok) {
      return undefined;
    }

    return AgentToolDispatcher.getInspectMutateFallbackReason(result.error);
  }

  private static getInspectMutateFallbackReason(error: string | undefined): string | undefined {
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
}

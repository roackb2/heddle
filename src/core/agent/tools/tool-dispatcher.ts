import type { Logger } from 'pino';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import {
  AutonomyPostflightAuditService,
  AutonomyTraceService,
  ToolApprovalPolicies,
  ToolApprovalService,
  type AutonomyEvaluation,
} from '@/core/approvals/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import { ToolExecutionService, type ToolRegistry } from '@/core/tools/index.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';
import { normalizeToolInput, stableSerialize } from '@/core/agent/utils/index.js';
import type { AgentRunLiveRecorder, RunAgentOptions } from '../types.js';

type ToolAuthorizationResult =
  | { type: 'allowed'; autonomyEvaluation?: AutonomyEvaluation }
  | { type: 'denied'; result: { ok: false; error: string } };

/**
 * Owns tool approval, execution, deduplication, and inspect-to-mutate fallback.
 *
 * ToolTurnService decides when tool calls are needed; this dispatcher owns how
 * a single call is authorized, executed, traced, and optionally retried.
 */
export class AgentToolDispatcher {
  static async authorizeToolCall(args: {
    call: ToolCall;
    tool: ToolDefinition | undefined;
    step: number;
    now: () => string;
    approvalPolicies?: ToolApprovalPolicy[];
    approveToolCall: RunAgentOptions['approveToolCall'];
    workspaceRoot?: string;
    live: AgentRunLiveRecorder;
    log: Logger;
  }): Promise<ToolAuthorizationResult> {
    const { call, tool, step, now, approveToolCall, live, log } = args;
    if (!tool) {
      return { type: 'allowed' };
    }

    const approval = await new ToolApprovalService().resolve({
      policies: [...ToolApprovalPolicies.default(), ...(args.approvalPolicies ?? [])],
      context: {
        call,
        tool,
        workspaceRoot: args.workspaceRoot,
      },
      // This await is the execution gate. Host implementations resolve
      // approveToolCall only after the user approves or denies the request, so
      // no approval-gated tool executes before the decision is returned.
      requestHumanApproval: approveToolCall ? async () => {
        live.traceActivity({
          trace: { type: HeddleEventType.toolApprovalRequested, call, step, timestamp: now() },
          activity: {
            type: HeddleEventType.toolApprovalRequested,
            call,
            step,
            derived: {
              kind: 'tool-summary',
              summary: ToolActivitySummarizer.summarizeCall(call),
            },
          },
        });
        // Control-plane hosts keep this promise resolver in memory and expose
        // the pending request through an API until the browser resolves it.
        const humanDecision = await approveToolCall(call, tool);
        live.traceActivity({
          trace: {
            type: HeddleEventType.toolApprovalResolved,
            call,
            approved: humanDecision.approved,
            reason: humanDecision.reason,
            step,
            timestamp: now(),
          },
          activity: {
            type: HeddleEventType.toolApprovalResolved,
            call,
            approved: humanDecision.approved,
            reason: humanDecision.reason,
            step,
            derived: {
              kind: 'tool-summary',
              summary: ToolActivitySummarizer.summarizeCall(call),
            },
          },
        });
        return humanDecision;
      } : undefined,
    });
    if (approval.autonomyEvaluation) {
      live.trace(AutonomyTraceService.decision({
        evaluation: approval.autonomyEvaluation,
        step,
        timestamp: now(),
      }));
    }
    if (approval.approved) {
      return {
        type: 'allowed',
        autonomyEvaluation: approval.autonomyEvaluation,
      };
    }

    const result = {
      ok: false as const,
      error:
        approval.reason ? `Approval denied for ${call.tool}: ${approval.reason}`
        : `Approval denied for ${call.tool}`,
    };
    log.warn({ step, tool: call.tool, reason: approval.reason }, 'Tool execution denied by approval policy');
    live.traceActivity({
      trace: { type: HeddleEventType.toolCompleted, call, result, durationMs: 0, step, timestamp: now() },
      activity: {
        type: HeddleEventType.toolCompleted,
        step,
        tool: call.tool,
        toolCallId: call.id,
        result,
        durationMs: 0,
      },
    });
    return { type: 'denied', result };
  }

  static async executeToolCallWithFallback(args: {
    call: ToolCall;
    autonomyEvaluation?: AutonomyEvaluation;
    step: number;
    now: () => string;
    registry: ToolRegistry;
    seenToolCalls: Map<string, number>;
    approvalPolicies?: ToolApprovalPolicy[];
    approveToolCall: RunAgentOptions['approveToolCall'];
    workspaceRoot?: string;
    live: AgentRunLiveRecorder;
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
    args.live.traceActivity({
      trace: {
        type: HeddleEventType.toolFallback,
        fromCall: args.call,
        toCall: mutateCall,
        reason: fallbackReason,
        step: args.step,
        timestamp: args.now(),
      },
      activity: {
        type: HeddleEventType.toolFallback,
        fromCall: args.call,
        toCall: mutateCall,
        reason: fallbackReason,
        step: args.step,
        derived: {
          kind: 'tool-fallback-summary',
          fromSummary: ToolActivitySummarizer.summarizeCall(args.call),
          toSummary: ToolActivitySummarizer.summarizeCall(mutateCall),
        },
      },
    });
    const authorization = await AgentToolDispatcher.authorizeToolCall({
      call: mutateCall,
      tool: mutateTool,
      step: args.step,
      now: args.now,
      approveToolCall: args.approveToolCall,
      approvalPolicies: args.approvalPolicies,
      workspaceRoot: args.workspaceRoot,
      live: args.live,
      log: args.log,
    });
    if (authorization.type === 'denied') {
      return { effectiveCall: mutateCall, result: authorization.result };
    }

    args.log.info(
      { step: args.step, from: args.call.tool, to: mutateCall.tool, reason: fallbackReason },
      'Retrying inspect failure through mutate fallback',
    );
    return AgentToolDispatcher.executeRecordedToolCall(mutateCall, {
      ...args,
      autonomyEvaluation: authorization.autonomyEvaluation,
    });
  }

  private static async executeRecordedToolCall(
    call: ToolCall,
    args: {
      autonomyEvaluation?: AutonomyEvaluation;
      step: number;
      now: () => string;
      registry: ToolRegistry;
      seenToolCalls: Map<string, number>;
      live: AgentRunLiveRecorder;
      log: Logger;
    },
  ): Promise<{ effectiveCall: ToolCall; result: Awaited<ReturnType<typeof ToolExecutionService.execute>> }> {
    const { step, now, registry, seenToolCalls, live, log } = args;
    log.info({ step, tool: call.tool }, 'Executing tool');
    const tool = registry.get(call.tool);
    const requiresApproval = tool?.requiresApproval ?? false;
    live.traceActivity({
      trace: { type: HeddleEventType.toolCalling, call, requiresApproval, step, timestamp: now() },
      activity: {
        type: HeddleEventType.toolCalling,
        step,
        tool: call.tool,
        toolCallId: call.id,
        input: call.input,
        requiresApproval,
        derived: {
          kind: 'tool-summary',
          summary: ToolActivitySummarizer.summarizeCall(call),
        },
      },
    });

    const signature = `${call.tool}:${stableSerialize(normalizeToolInput(call.tool, call.input))}`;
    const seenCount = seenToolCalls.get(signature) ?? 0;
    if (seenCount >= 2) {
      log.warn(
        { step, tool: call.tool, repeatCount: seenCount + 1 },
        'Executing repeated identical tool call; warning only',
      );
    }

    const startedAt = Date.now();
    const rawResult = await ToolExecutionService.execute(registry, call);
    const audit = AutonomyPostflightAuditService.shouldAudit(args.autonomyEvaluation)
      ? AutonomyPostflightAuditService.create({
        evaluation: args.autonomyEvaluation,
        result: rawResult,
        workspaceRoot: args.autonomyEvaluation.facts.cwd,
      })
      : undefined;
    const result = audit?.decision === 'stop'
      ? {
        ok: false as const,
        error: `Autopilot postflight audit stopped the run: ${audit.reason ?? 'observed effects exceeded policy'}`,
        output: {
          toolResult: rawResult,
          audit,
        },
      }
      : rawResult;
    const durationMs = Date.now() - startedAt;
    seenToolCalls.set(signature, seenCount + 1);
    log.debug({ step, tool: call.tool, ok: result.ok }, 'Tool result');
    if (audit) {
      live.trace(AutonomyTraceService.postflight({
        audit,
        step,
        timestamp: now(),
      }));
    }
    live.traceActivity({
      trace: { type: HeddleEventType.toolCompleted, call, result, durationMs, step, timestamp: now() },
      activity: {
        type: HeddleEventType.toolCompleted,
        step,
        tool: call.tool,
        toolCallId: call.id,
        result,
        durationMs,
      },
    });
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

/**
 * Owns conversation-level direct shell semantics.
 *
 * Shell-process tools own command policy and execution. This service owns what
 * `!command` means inside a chat session: lease-held session recording,
 * policy preflight, confirmed execution, live activity, compaction, and
 * persisted result text shared by web-v2 and cli-v2. Direct-shell confirmation
 * is a host UX concern; this service only enforces the preflight result.
 */
import { HeddleEventType } from '@/core/event-types.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import type { ChatMessage } from '@/core/llm/types.js';
import type { ConversationDirectShellLineResult } from '@/core/chat/types.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_INSPECT_RULES,
  DEFAULT_MUTATE_RULES,
  runShellCommand,
} from '@/core/tools/toolkits/shell-process/index.js';
import type { ToolCall, ToolResult } from '@/core/types.js';
import type {
  ConversationDirectShellInput,
  ConversationDirectShellPreflight,
  ConversationDirectShellResult,
  DirectShellToolName,
} from './types.js';

export class ConversationDirectShellService {
  static preflight(commandInput: string): ConversationDirectShellPreflight {
    const command = commandInput.trim();
    if (!command) {
      return {
        command,
        risk: 'blocked',
        reason: 'Direct shell command cannot be empty.',
      };
    }

    const inspectPolicy = classifyShellCommandPolicy(command, {
      toolName: 'run_shell_inspect',
      rules: DEFAULT_INSPECT_RULES,
      allowUnknown: false,
    });
    if (!('error' in inspectPolicy)) {
      return {
        command,
        risk: 'safe',
        tool: 'run_shell_inspect',
        reason: inspectPolicy.reason,
      };
    }

    const mutatePolicy = classifyShellCommandPolicy(command, {
      toolName: 'run_shell_mutate',
      rules: DEFAULT_MUTATE_RULES,
      allowUnknown: true,
    });
    if ('error' in mutatePolicy) {
      return {
        command,
        risk: 'blocked',
        tool: 'run_shell_mutate',
        reason: mutatePolicy.error,
      };
    }

    return {
      command,
      risk: mutatePolicy.risk === 'low' ? 'safe' : 'confirmRequired',
      tool: 'run_shell_mutate',
      reason: mutatePolicy.reason,
    };
  }

  static async execute(input: ConversationDirectShellInput): Promise<ConversationDirectShellResult> {
    const command = input.command.trim();
    if (!command) {
      throw new Error('Direct shell command cannot be empty.');
    }

    const preflight = ConversationDirectShellService.preflight(command);
    if (preflight.risk === 'blocked') {
      return ConversationDirectShellService.createPreflightStopResult(preflight, 'blocked');
    }

    if (preflight.risk === 'confirmRequired' && !input.riskAccepted) {
      return ConversationDirectShellService.createPreflightStopResult(preflight, 'confirmation_required');
    }

    const session = await input.sessions.require(input.sessionId);
    const shellDisplay = `!${command}`;
    await input.sessions.appendMessage(input.sessionId, {
      id: `direct-shell-user-${input.runId}`,
      role: 'user',
      text: shellDisplay,
    });
    await input.sessions.setLastContinuePrompt(input.sessionId, undefined);

    const chosenCall = ConversationDirectShellService.createCall(input.runId, preflight.tool ?? 'run_shell_inspect', command);
    const options = chosenCall.tool === 'run_shell_inspect' ? {
      toolName: chosenCall.tool,
      rules: DEFAULT_INSPECT_RULES,
      allowUnknown: false,
      cwd: input.workspaceRoot,
    } : {
      toolName: chosenCall.tool,
      rules: DEFAULT_MUTATE_RULES,
      allowUnknown: true,
      cwd: input.workspaceRoot,
    };

    input.onActivity?.(ConversationDirectShellService.createStartedActivity(input, chosenCall));
    const shellRun = await ConversationDirectShellService.runShellWithDuration(
      chosenCall.input,
      {
        ...options,
      },
      input.abortSignal,
    );

    const chosenResult = shellRun.result;
    const chosenDurationMs = shellRun.durationMs;

    const resultFacts = ConversationDirectShellService.buildResultFacts(chosenCall.tool, command, chosenResult, chosenDurationMs);
    const directShellHistory: ChatMessage[] = [
      ...session.history,
      { role: 'user', content: shellDisplay },
      { role: 'assistant', content: JSON.stringify(resultFacts) },
    ];
    const compacted = await ConversationCompactionService.compact({
      history: directShellHistory,
      runtime: {
        model: input.model,
        stateRoot: input.stateRoot,
        systemContext: input.systemContext,
      },
      session,
      archiveRepository: input.archiveRepository,
      request: {
        toolNames: [chosenCall.tool],
        goal: shellDisplay,
      },
      summarizer: input.summarizer,
      onStatusChange: input.onCompactionStatus,
    });

    await input.sessions.applyCompactionResult(input.sessionId, compacted);
    input.onActivity?.(ConversationDirectShellService.createCompletedActivity(input, chosenCall, chosenResult, chosenDurationMs));

    return {
      outcome: chosenResult.ok ? 'done' : 'error',
      summary: resultFacts.outcome,
      command,
      shellDisplay,
      tool: chosenCall.tool,
      result: resultFacts,
    };
  }

  private static createCall(runId: string, tool: DirectShellToolName, command: string): ToolCall & { tool: DirectShellToolName } {
    return {
      id: `${runId}-${tool}`,
      tool,
      input: { command },
    };
  }

  private static createStartedActivity(
    input: ConversationDirectShellInput,
    call: ToolCall & { tool: DirectShellToolName },
  ) {
    return {
      source: 'direct-shell' as const,
      type: HeddleEventType.directShellStarted,
      runId: input.runId,
      command: ConversationDirectShellService.readCommand(call),
      tool: call.tool,
      timestamp: new Date().toISOString(),
    };
  }

  private static createCompletedActivity(
    input: ConversationDirectShellInput,
    call: ToolCall & { tool: DirectShellToolName },
    result: ToolResult,
    durationMs: number,
  ) {
    return {
      source: 'direct-shell' as const,
      type: HeddleEventType.directShellCompleted,
      runId: input.runId,
      command: ConversationDirectShellService.readCommand(call),
      tool: call.tool,
      result,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  private static extractTextOutput(value: unknown, field: 'stdout' | 'stderr'): string | undefined {
    const text = ConversationDirectShellService.readStringField(value, field);
    return text?.trim() ? text.trim() : undefined;
  }

  private static async runShellWithDuration(
    raw: unknown,
    options: Parameters<typeof runShellCommand>[1],
    signal?: AbortSignal,
  ): Promise<{ result: ToolResult; durationMs: number }> {
    const startedAt = Date.now();
    const result = await runShellCommand(raw, options, signal);
    return {
      result,
      durationMs: Date.now() - startedAt,
    };
  }

  private static readCommand(call: ToolCall): string {
    return ConversationDirectShellService.readStringField(call.input, 'command') ?? '';
  }

  private static readStringField(value: unknown, field: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private static buildResultFacts(
    tool: DirectShellToolName,
    command: string,
    result: ToolResult,
    durationMs: number,
  ): ConversationDirectShellLineResult {
    return {
      kind: 'direct_shell_result',
      command,
      tool,
      outcome: result.ok ? 'done' : 'error',
      exitCode: ConversationDirectShellService.readNumberField(result.output, 'exitCode'),
      stdout: ConversationDirectShellService.extractTextOutput(result.output, 'stdout'),
      stderr: ConversationDirectShellService.extractTextOutput(result.output, 'stderr'),
      error: result.error,
      durationMs,
      policy: ConversationDirectShellService.extractPolicy(result.output),
    };
  }

  private static extractPolicy(value: unknown): ConversationDirectShellLineResult['policy'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const policy = (value as { policy?: unknown }).policy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      return undefined;
    }

    const candidate = policy as Record<string, unknown>;
    return {
      binary: ConversationDirectShellService.readStringField(candidate, 'binary'),
      scope: ConversationDirectShellService.readStringField(candidate, 'scope'),
      risk: ConversationDirectShellService.readStringField(candidate, 'risk'),
      capability: ConversationDirectShellService.readStringField(candidate, 'capability'),
      reason: ConversationDirectShellService.readStringField(candidate, 'reason'),
    };
  }

  private static readNumberField(value: unknown, field: string): number | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === 'number' ? candidate : undefined;
  }

  private static createPreflightStopResult(
    preflight: ConversationDirectShellPreflight,
    outcome: 'blocked' | 'confirmation_required',
  ): ConversationDirectShellResult {
    const summary = outcome === 'confirmation_required'
      ? `Direct shell command requires confirmation: ${preflight.reason ?? preflight.command}`
      : `Direct shell command blocked: ${preflight.reason ?? preflight.command}`;
    return {
      outcome,
      summary,
      command: preflight.command,
      shellDisplay: `!${preflight.command}`,
      tool: preflight.tool,
    };
  }
}

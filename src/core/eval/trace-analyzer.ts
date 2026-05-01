import { existsSync, readFileSync } from 'node:fs';
import type { TraceEvent } from '../types.js';
import type { EvalTraceMetrics } from './schema.js';

const MUTATION_TOOLS = new Set(['edit_file', 'delete_file', 'move_file', 'run_shell_mutate']);
const READ_OR_SEARCH_TOOLS = new Set(['read_file', 'list_files', 'search_files', 'run_shell_inspect']);

export function analyzeTraceFiles(paths: string[]): EvalTraceMetrics {
  return analyzeTrace(paths.flatMap(readTraceFile));
}

export function analyzeTrace(trace: TraceEvent[]): EvalTraceMetrics {
  const toolsByName: Record<string, number> = {};
  const readOrSearchBeforeMutation: string[] = [];
  let assistantTurns = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let mutations = 0;
  let approvalsRequested = 0;
  let approvalsResolved = 0;
  let toolErrors = 0;
  let verificationCommandsAfterMutation = 0;
  let firstMutationStep: number | undefined;
  let outcome: string | undefined;
  let summary: string | undefined;

  for (const event of trace) {
    if (event.type === 'assistant.turn') {
      assistantTurns++;
      for (const call of event.toolCalls ?? []) {
        toolCalls++;
        toolsByName[call.tool] = (toolsByName[call.tool] ?? 0) + 1;

        if (READ_OR_SEARCH_TOOLS.has(call.tool) && firstMutationStep === undefined) {
          readOrSearchBeforeMutation.push(summarizeToolInput(call.tool, call.input));
        }

        if (MUTATION_TOOLS.has(call.tool)) {
          mutations++;
          firstMutationStep ??= event.step;
        }

        if (firstMutationStep !== undefined && call.tool === 'run_shell_mutate' && isVerificationCommand(call.input)) {
          verificationCommandsAfterMutation++;
        }
      }
      continue;
    }

    if (event.type === 'tool.result') {
      toolResults++;
      if (!event.result.ok) {
        toolErrors++;
      }
    }

    if (event.type === 'tool.approval_requested') {
      approvalsRequested++;
    }

    if (event.type === 'tool.approval_resolved') {
      approvalsResolved++;
    }

    if (event.type === 'run.finished') {
      outcome = event.outcome;
      summary = event.summary;
    }
  }

  return {
    assistantTurns,
    toolCalls,
    toolResults,
    mutations,
    approvalsRequested,
    approvalsResolved,
    toolErrors,
    verificationCommandsAfterMutation,
    firstMutationStep,
    outcome,
    summary,
    toolsByName,
    readOrSearchBeforeMutation: [...new Set(readOrSearchBeforeMutation)],
  };
}

export function readTraceFile(path: string): TraceEvent[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return Array.isArray(parsed) ? parsed.filter(isTraceEvent) : [];
}

function isTraceEvent(value: unknown): value is TraceEvent {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string');
}

function summarizeToolInput(tool: string, input: unknown): string {
  const object = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
  const path = object && typeof object.path === 'string' ? object.path : undefined;
  const query = object && typeof object.query === 'string' ? object.query : undefined;
  const command = object && typeof object.command === 'string' ? object.command : undefined;
  return `${tool}:${path ?? query ?? command ?? ''}`.slice(0, 160);
}

function isVerificationCommand(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return false;
  }
  const command = (input as { command?: unknown }).command;
  if (typeof command !== 'string') {
    return false;
  }
  return /\b(yarn|npm|pnpm|vitest|jest|mocha|tsc|eslint|cargo|go|pytest|python|ruff)\b/.test(command)
    && /\b(test|build|lint|typecheck|check|vitest|tsc|pytest|ruff)\b/.test(command);
}

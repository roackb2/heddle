import type { ChatMessage, TraceEvent, ToolResult } from '../../../index.js';
import type { EditFilePreview } from '../../../core/tools/edit-file.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_MUTATE_RULES,
  type RunShellPolicyDecision,
} from '../../../core/tools/run-shell.js';
import { truncate } from '../../../core/chat/format.js';
export {
  buildConversationMessages,
  countAssistantSteps,
  formatChatFailureMessage,
  summarizeTrace,
  truncate,
} from '../../../core/chat/format.js';
import type { LiveEvent, PendingApproval } from '../state/types.js';

export type ApprovalSummary = {
  title: string;
  command?: string;
  scope?: string;
  risk?: string;
  capability?: string;
  why: string;
  effects: string[];
  rememberLabel?: string;
};

export type ChatFailureHintOptions = {
  model: string;
  estimatedHistoryTokens?: number;
};

const MAX_SHELL_OUTPUT_CHARS = 1400;
const MAX_TOOL_CALL_SUMMARY_CHARS = 96;


export function toLiveEvent(event: TraceEvent): string | undefined {
  switch (event.type) {
    case 'run.started':
      return 'thinking';
    case 'assistant.turn':
      if (event.diagnostics?.rationale) {
        return `reasoning: ${truncate(event.diagnostics.rationale, 140)}`;
      }
      if (event.requestedTools) {
        return undefined;
      }
      return 'answer ready';
    case 'tool.approval_requested':
      return `approval needed for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.approval_resolved':
      return `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}${event.reason ? ` (${truncate(event.reason, 80)})` : ''}`;
    case 'tool.fallback':
      return `retrying with ${summarizeToolCall(event.toCall.tool, event.toCall.input)} after ${summarizeToolCall(event.fromCall.tool, event.fromCall.input)} was blocked (${truncate(event.reason, 80)})`;
    case 'tool.call':
      return `running ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.result':
      return `${summarizeToolResult(event.tool, extractShellCommand(event.result.output), event.result.output)} ${event.result.ok ? 'completed' : `failed: ${event.result.error ?? 'error'}`}`;
    case 'cyberloop.annotation':
      return event.driftLevel === 'unknown' ? undefined : `cyberloop drift=${event.driftLevel}${formatCyberLoopMetrics(event.metadata)}`;
    case 'run.finished':
      return event.outcome === 'done' ? undefined : `stopped: ${event.outcome}`;
    default:
      return undefined;
  }
}

function formatCyberLoopMetrics(metadata: Record<string, unknown>): string {
  const kinematics = metadata.kinematics;
  if (!kinematics || typeof kinematics !== 'object' || Array.isArray(kinematics)) {
    return '';
  }

  const snapshot = kinematics as {
    errorMagnitude?: unknown;
    correctionMagnitude?: unknown;
    isStable?: unknown;
  };
  const parts: string[] = [];
  if (typeof snapshot.errorMagnitude === 'number') {
    parts.push(`err=${formatMetric(snapshot.errorMagnitude)}`);
  }
  if (typeof snapshot.correctionMagnitude === 'number') {
    parts.push(`corr=${formatMetric(snapshot.correctionMagnitude)}`);
  }
  if (typeof snapshot.isStable === 'boolean') {
    parts.push(`stable=${snapshot.isStable}`);
  }

  return parts.length ? ` (${parts.join(' ')})` : '';
}

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) < 0.001 && value !== 0) {
    return value.toExponential(2);
  }
  return value.toFixed(3);
}

export function currentActivityText(
  liveEvents: LiveEvent[],
  isRunning: boolean,
  elapsedSeconds: number,
  pendingApproval?: PendingApproval,
  interruptRequested?: boolean,
): string {
  if (pendingApproval) {
    return formatApprovalPrompt(pendingApproval);
  }

  if (interruptRequested) {
    return 'interrupt requested; waiting for the current step to finish';
  }

  const current = liveEvents[liveEvents.length - 1]?.text;
  if (isRunning) {
    return current ? `${current} · ${elapsedSeconds}s` : 'waiting for first agent event...';
  }

  return current ?? 'idle';
}

export function formatApprovalPrompt(pendingApproval: PendingApproval): string {
  return summarizePendingApproval(pendingApproval).title;
}

export function formatApprovalHint(pendingApproval: PendingApproval): string {
  const summary = summarizePendingApproval(pendingApproval);
  const rememberLabel = summary.rememberLabel ? `A ${summary.rememberLabel}` : 'A remember for project';
  return `Y approve once • ${rememberLabel} • N deny • Enter confirms selected choice`;
}

export function summarizePendingApproval(pendingApproval: PendingApproval): ApprovalSummary {
  const policy = describePendingApprovalPolicy(pendingApproval);
  const command = extractShellCommand(pendingApproval.call.input);
  const editPath = extractEditPath(pendingApproval.call.input);

  if (command) {
    const title =
      policy?.capability === 'verification' ? 'Run verification command'
      : policy?.scope === 'external' ? 'Run external command'
      : 'Run mutation command';
    const why =
      policy ? `${policy.scope} scope • ${policy.capability} • ${policy.risk} risk`
      : 'approval required before running this command';
    const effects = buildApprovalEffects({
      tool: pendingApproval.call.tool,
      command,
      scope: policy?.scope,
      capability: policy?.capability,
      risk: policy?.risk,
    });

    return {
      title,
      command,
      scope: policy?.scope,
      risk: policy?.risk,
      capability: policy?.capability,
      why,
      effects,
      rememberLabel: pendingApproval.rememberLabel,
    };
  }

  if (pendingApproval.call.tool === 'edit_file') {
    const scope = editPath && (editPath.startsWith('../') || editPath.startsWith('/') || editPath.includes('..\\')) ? 'external' : 'workspace';
    return {
      title: scope === 'external' ? 'Edit external file' : 'Edit file',
      command: editPath,
      scope,
      risk: 'medium',
      capability: 'file_edit',
      why: editPath ? `edit_file on ${editPath}` : 'approval required before editing a file',
      effects: [
        editPath ? `modifies ${editPath}` : `modifies a ${scope} file`,
        scope === 'external' ? 'writes outside the current repository' : 'stays inside the current repository',
      ],
      rememberLabel: pendingApproval.rememberLabel,
    };
  }

  return {
    title: `Allow ${pendingApproval.call.tool}`,
    why: 'approval required for this tool call',
    effects: ['tool-specific side effects are not yet summarized'],
    rememberLabel: pendingApproval.rememberLabel,
  };
}

export function summarizeToolCall(tool: string, input: unknown): string {
  const planSummary = summarizePlanInput(tool, input);
  if (planSummary) {
    return planSummary;
  }

  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${truncate(shellCommand, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const searchSummary = summarizeSearchInput(tool, input);
  if (searchSummary) {
    return searchSummary;
  }

  const path = extractPathField(input);
  if (isPathAwareTool(tool) && path) {
    return `${tool} (${truncate(path, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

export function summarizeToolResult(tool: string, command: string | undefined, output?: unknown): string {
  if (command) {
    return `${tool} (${truncate(command, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const outputPath = extractOutputPath(output);
  if (tool === 'edit_file' && outputPath) {
    return `${tool} (${truncate(outputPath, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

export function extractShellCommand(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

export function extractEditPath(value: unknown): string | undefined {
  return extractPathField(value);
}

export function extractPathField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

export function extractQueryField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const query = (value as { query?: unknown }).query;
  return typeof query === 'string' && query.trim() ? query.trim() : undefined;
}

export function extractOutputPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

export function normalizeInlineText(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

export function shouldFallbackToMutate(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  return error.includes('run_shell_inspect policy') || error.includes('Inspect mode permits read-only pipes');
}

export function formatDirectShellResponse(toolName: string, command: string, result: ToolResult): string {
  const lines = [
    '## Direct shell result',
    '',
    `Command: \`${command}\``,
    `Tool: ${toolName}`,
  ];

  const policy = extractPolicySummary(result.output);
  if (policy) {
    lines.push(`Policy: ${policy}`);
  }

  if (result.ok) {
    const stdout = extractTextOutput(result.output, 'stdout');
    const stderr = extractTextOutput(result.output, 'stderr');
    lines.push('Outcome: success');
    if (stdout) {
      lines.push('', '### stdout', '```text', truncate(stdout, MAX_SHELL_OUTPUT_CHARS), '```');
    }
    if (stderr) {
      lines.push('', '### stderr', '```text', truncate(stderr, MAX_SHELL_OUTPUT_CHARS), '```');
    }
    if (!stdout && !stderr) {
      lines.push('', 'No stdout or stderr output.');
    }
    return lines.join('\n');
  }

  lines.push('Outcome: failed');
  if (result.error) {
    lines.push('', `Error: ${result.error}`);
  }
  const stdout = extractTextOutput(result.output, 'stdout');
  const stderr = extractTextOutput(result.output, 'stderr');
  if (stdout) {
    lines.push('', '### stdout', '```text', truncate(stdout, MAX_SHELL_OUTPUT_CHARS), '```');
  }
  if (stderr) {
    lines.push('', '### stderr', '```text', truncate(stderr, MAX_SHELL_OUTPUT_CHARS), '```');
  }
  return lines.join('\n');
}

export function extractTextOutput(value: unknown, field: 'stdout' | 'stderr'): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

export function extractPolicySummary(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const policy = (value as { policy?: unknown }).policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return undefined;
  }

  const candidate = policy as Record<string, unknown>;
  const scope = typeof candidate.scope === 'string' ? candidate.scope : undefined;
  const risk = typeof candidate.risk === 'string' ? candidate.risk : undefined;
  const reason = typeof candidate.reason === 'string' ? candidate.reason : undefined;
  const parts = [scope, risk, reason].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function describePendingApprovalPolicy(pendingApproval: PendingApproval): RunShellPolicyDecision | undefined {
  if (pendingApproval.call.tool !== 'run_shell_mutate') {
    return undefined;
  }

  const command = extractShellCommand(pendingApproval.call.input);
  if (!command) {
    return undefined;
  }

  const result = classifyShellCommandPolicy(command, {
    toolName: 'run_shell_mutate',
    rules: DEFAULT_MUTATE_RULES,
    allowUnknown: true,
  });

  return 'error' in result ? undefined : result;
}

function buildApprovalEffects(options: {
  tool: string;
  command: string;
  scope?: string;
  capability?: string;
  risk?: string;
}): string[] {
  const effects: string[] = [];

  if (options.scope === 'workspace') {
    effects.push('stays inside the current repository');
  }

  if (options.scope === 'external') {
    effects.push('may affect an external system outside the repo');
  }

  if (options.capability === 'verification') {
    effects.push('runs a verification command to check current changes');
  }

  if (options.capability === 'git_staging') {
    effects.push('updates git staging state');
  }

  if (options.capability === 'project_script') {
    effects.push('runs a project-defined script with repo-defined side effects');
  }

  if (options.risk === 'unknown') {
    effects.push('command is not specifically classified, so review the exact command carefully');
  }

  if (effects.length === 0) {
    effects.push(`runs: ${truncate(options.command, 96)}`);
  }

  return effects;
}

export function isGenericSessionName(name: string): boolean {
  return /^Session \d+$/.test(name.trim());
}

export function normalizeSessionTitle(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return undefined;
  }

  return truncate(normalized, 48);
}

function isPathAwareTool(tool: string): boolean {
  return tool === 'edit_file' || tool === 'read_file' || tool === 'list_files';
}

function summarizeSearchInput(tool: string, input: unknown): string | undefined {
  if (tool !== 'search_files') {
    return undefined;
  }

  const query = extractQueryField(input);
  if (!query) {
    return tool;
  }

  const path = extractPathField(input);
  const querySummary = truncate(JSON.stringify(query), Math.max(12, Math.floor(MAX_TOOL_CALL_SUMMARY_CHARS / 2)));
  if (path) {
    return `${tool} (${querySummary} in ${truncate(path, Math.max(12, Math.floor(MAX_TOOL_CALL_SUMMARY_CHARS / 2)))})`;
  }

  return `${tool} (${querySummary})`;
}

function summarizePlanInput(tool: string, input: unknown): string | undefined {
  if (tool !== 'update_plan') {
    return undefined;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return tool;
  }

  const plan = (input as { plan?: unknown }).plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    return tool;
  }

  const current = plan.find((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as { status?: unknown }).status === 'in_progress');
  const currentStep = current && typeof (current as { step?: unknown }).step === 'string' ? (current as { step: string }).step : undefined;
  return currentStep ? `${tool} (${truncate(currentStep, MAX_TOOL_CALL_SUMMARY_CHARS)})` : `${tool} (${plan.length} items)`;
}

function renderUpdatePlanHistoryMessage(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  const candidate = output as { explanation?: unknown; plan?: unknown };
  if (!Array.isArray(candidate.plan) || candidate.plan.length === 0) {
    return undefined;
  }

  const lines = ['## Plan'];
  if (typeof candidate.explanation === 'string' && candidate.explanation.trim()) {
    lines.push('', candidate.explanation.trim());
  }

  lines.push(
    '',
    ...candidate.plan.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }

      const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step.trim() : '';
      const status = (item as { status?: unknown }).status;
      if (!step || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
        return [];
      }

      return [`- ${planStatusMarker(status)} ${step}`];
    }),
  );

  return lines.join('\n');
}

function planStatusMarker(status: 'pending' | 'in_progress' | 'completed'): string {
  if (status === 'completed') {
    return '[x]';
  }
  if (status === 'in_progress') {
    return '[-]';
  }
  return '[ ]';
}

export function formatEditPreviewHistoryMessage(preview: EditFilePreview): string {
  return formatEditHistoryMessage({
    path: preview.path,
    action: preview.action,
    diff: preview.diff,
    truncated: preview.truncated,
  });
}

export function formatPlanHistoryMessage(output: unknown): string | undefined {
  return renderUpdatePlanHistoryMessage(output);
}

function formatEditHistoryMessage(options: {
  path: string;
  action: string;
  matchCount?: number;
  bytesWritten?: number;
  diff?: string;
  truncated?: boolean;
}): string {
  const lines = [
    `## Edited \`${options.path}\``,
    '',
    `Action: ${options.action}`,
  ];

  if (typeof options.matchCount === 'number') {
    lines.push(`Matches changed: ${options.matchCount}`);
  }

  if (typeof options.bytesWritten === 'number') {
    lines.push(`Bytes written: ${options.bytesWritten}`);
  }

  if (options.diff) {
    lines.push('', '```diff', options.diff, '```');
  }

  if (options.truncated) {
    lines.push('', 'Preview truncated.');
  }

  return lines.join('\n');
}

export function appendDirectShellHistory(
  history: ChatMessage[],
  shellDisplay: string,
  toolName: string,
  result: ToolResult,
): ChatMessage[] {
  const summary = buildDirectShellHistorySummary(toolName, result);
  const userMessage: ChatMessage = { role: 'user', content: shellDisplay };
  const assistantMessage: ChatMessage = { role: 'assistant', content: summary };
  return [...history, userMessage, assistantMessage];
}

function buildDirectShellHistorySummary(toolName: string, result: ToolResult): string {
  const lines = [`## Direct shell command via \`${toolName}\``];
  const policy = extractPolicySummary(result.output);
  if (policy) {
    lines.push(`Policy: ${policy}`);
  }
  lines.push(`Outcome: ${result.ok ? 'success' : 'failure'}`);
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  const stdout = extractTextOutput(result.output, 'stdout');
  const stderr = extractTextOutput(result.output, 'stderr');
  if (stdout) {
    lines.push('### stdout', '```text', truncate(stdout, 1200), '```');
  }
  if (stderr) {
    lines.push('### stderr', '```text', truncate(stderr, 800), '```');
  }

  return lines.join('\n\n');
}

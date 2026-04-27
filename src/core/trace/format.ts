// ---------------------------------------------------------------------------
// Trace Formatter — human-readable console output
// ---------------------------------------------------------------------------

import type { TraceEvent } from '../types.js';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

/**
 * Format a trace for console display.
 */
export function formatTraceForConsole(trace: TraceEvent[]): string {
  const lines: string[] = [];

  for (const event of trace) {
    switch (event.type) {
      case 'run.started':
        lines.push(
          `${COLORS.bold}${COLORS.cyan}▶ RUN STARTED${COLORS.reset}  ${COLORS.dim}${event.timestamp}${COLORS.reset}`,
          `  Goal: ${event.goal}`,
          '',
        );
        break;

      case 'assistant.turn': {
        const requestedToolNames = event.toolCalls?.map((call) => call.tool) ?? [];
        lines.push(
          `${COLORS.magenta}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Assistant:${COLORS.reset}`,
        );
        if (event.content) {
          lines.push(`  ${truncate(event.content, 500)}`);
        } else if (event.requestedTools) {
          lines.push(
            `  (no text content; requested ${requestedToolNames.length} tool call${requestedToolNames.length === 1 ? '' : 's'})`,
          );
        }
        if (event.requestedTools) {
          lines.push(
            `  Requested Tools: ${requestedToolNames.join(', ')} (${requestedToolNames.length})`,
          );
        }
        if (event.diagnostics?.missing?.length) {
          lines.push(`  Missing: ${event.diagnostics.missing.join('; ')}`);
        }
        if (event.diagnostics?.wantedTools?.length) {
          lines.push(`  Wanted Tools: ${event.diagnostics.wantedTools.join(', ')}`);
        }
        if (event.diagnostics?.wantedInputs?.length) {
          lines.push(`  Wanted Inputs: ${event.diagnostics.wantedInputs.join('; ')}`);
        }
        lines.push('');
        break;
      }

      case 'host.warning':
        lines.push(
          `${COLORS.red}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Host Warning:${COLORS.reset} ${event.message}`,
          event.details ? `  Details: ${truncate(JSON.stringify(event.details), 500)}` : '',
          '',
        );
        break;

      case 'tool.call':
        lines.push(
          `${COLORS.yellow}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Tool Call:${COLORS.reset} ${event.call.tool}`,
          `  Input: ${truncate(JSON.stringify(event.call.input), 200)}`,
        );
        break;

      case 'tool.approval_requested':
        lines.push(
          `${COLORS.yellow}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Approval Required:${COLORS.reset} ${event.call.tool}`,
          `  Input: ${truncate(JSON.stringify(event.call.input), 200)}`,
        );
        break;

      case 'tool.approval_resolved':
        lines.push(
          `${event.approved ? COLORS.green : COLORS.red}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Approval ${event.approved ? 'Granted' : 'Denied'}:${COLORS.reset} ${event.call.tool}`,
          `  Reason: ${event.reason ?? (event.approved ? 'approved' : 'no reason provided')}`,
        );
        break;

      case 'tool.fallback':
        lines.push(
          `${COLORS.yellow}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Tool Fallback:${COLORS.reset} ${event.fromCall.tool} → ${event.toCall.tool}`,
          `  Reason: ${event.reason}`,
          `  Command: ${truncate(JSON.stringify(event.toCall.input), 200)}`,
        );
        break;

      case 'tool.result': {
        const color = event.result.ok ? COLORS.green : COLORS.red;
        const status = event.result.ok ? '✓' : '✗';
        const content = event.result.ok
          ? formatToolResultOutput(event.result.output)
          : `ERROR: ${event.result.error}`;
        lines.push(
          `${color}  ${status} ${event.tool}${COLORS.reset}: ${content}`,
          '',
        );
        break;
      }

      case 'cyberloop.annotation': {
        const color =
          event.driftLevel === 'high' ? COLORS.red
          : event.driftLevel === 'medium' ? COLORS.yellow
          : event.driftLevel === 'low' ? COLORS.green
          : COLORS.dim;
        lines.push(
          `${color}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}CyberLoop:${COLORS.reset} drift=${event.driftLevel} frame=${event.frameKind}${formatCyberLoopMetrics(event.metadata)}${event.requestedHalt ? ' halt-requested' : ''}`,
          `  Metadata: ${truncate(JSON.stringify(event.metadata), 500)}`,
          '',
        );
        break;
      }

      case 'run.finished': {
        const outcomeColor =
          event.outcome === 'done' ? COLORS.green
          : event.outcome === 'max_steps' ? COLORS.yellow
          : COLORS.red;
        lines.push(
          `${COLORS.bold}${outcomeColor}■ RUN FINISHED${COLORS.reset}  outcome=${event.outcome}  ${COLORS.dim}${event.timestamp}${COLORS.reset}`,
          `  Summary: ${event.summary}`,
          '',
        );
        break;
      }
    }
  }

  return lines.join('\n');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
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

function formatToolResultOutput(output: unknown): string {
  if (output == null) {
    return '';
  }

  if (typeof output === 'string') {
    return truncate(output, 300);
  }

  return truncate(JSON.stringify(output, null, 2), 300);
}

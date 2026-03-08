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

      case 'model.message':
        lines.push(
          `${COLORS.magenta}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Model:${COLORS.reset}`,
          `  ${truncate(event.content, 500)}`,
          '',
        );
        break;

      case 'tool.call':
        lines.push(
          `${COLORS.yellow}  [step ${event.step}]${COLORS.reset} ${COLORS.bold}Tool Call:${COLORS.reset} ${event.call.tool}`,
          `  Input: ${truncate(JSON.stringify(event.call.input), 200)}`,
        );
        break;

      case 'tool.result': {
        const color = event.result.ok ? COLORS.green : COLORS.red;
        const status = event.result.ok ? '✓' : '✗';
        const content = event.result.ok
          ? truncate(String(event.result.output ?? ''), 300)
          : `ERROR: ${event.result.error}`;
        lines.push(
          `${color}  ${status} ${event.tool}${COLORS.reset}: ${content}`,
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

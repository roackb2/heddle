/**
 * Heartbeat runner agent prompt builder.
 *
 * Owns the autonomous heartbeat instructions that are added around a durable
 * task before it is handed to the generic runtime loop.
 */
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import type { HeartbeatRunnerAgentRunContext } from './types.js';

dayjs.extend(duration);

export class HeartbeatRunnerAgentPrompt {
  static buildGoal(task: string, runContext?: HeartbeatRunnerAgentRunContext): string {
    return `# Heartbeat Run

Work autonomously on the task if there is useful, safe progress to make now.
Do not wait for a chat message.
If blocked, risky, or user input is required, escalate clearly instead of guessing.

End your response with exactly one decision line:

\`HEARTBEAT_DECISION: continue | pause | complete | escalate\`

## Durable Task

${task}${HeartbeatRunnerAgentPrompt.formatRunContext(runContext)}`;
  }

  static appendSystemContext(systemContext: string | undefined): string {
    const heartbeatContext = `## Heartbeat Mode

This run was started by an autonomous heartbeat, not by a live chat message.
Operate within the available tools and approval policy.
There may be no live approval handler. Prefer read-only tools and simple \`run_shell_inspect\` commands without \`cd\`, \`&&\`, redirects, or subshells.
The shell already runs from the workspace root. For git inspection, use commands such as \`git status -sb\` directly instead of \`cd <path> && git status\`.
Use memory-note tools for durable observations when useful.
Make bounded useful progress, update durable memory when appropriate, and stop cleanly.
Escalate only when human input, credentials, policy approval, or risky judgment is required.
The required final decision line is: \`HEARTBEAT_DECISION: continue | pause | complete | escalate\``;

    return systemContext ? `${heartbeatContext}\n\n${systemContext}` : heartbeatContext;
  }

  private static formatRunContext(context: HeartbeatRunnerAgentRunContext | undefined): string {
    if (!context) {
      return '';
    }

    return `

## Current Run Context

- Current date time: ${context.currentDateTime}
- Run interval: ${HeartbeatRunnerAgentPrompt.formatInterval(context.intervalMs)}
- Continuation control: ${HeartbeatRunnerAgentPrompt.formatContinuationMode(context.continuationMode)}
- Previous run: ${context.previousRunAt ?? 'none'}${context.previousRunId ? ` (${context.previousRunId})` : ''}
- Next scheduled run: ${context.nextRunAt ?? 'not scheduled'}`;
  }

  private static formatContinuationMode(mode: HeartbeatRunnerAgentRunContext['continuationMode']): string {
    return mode === 'agent' ?
      'agent-controlled; your final decision can stop or delay future runs'
    : 'operator-controlled; your final decision is recorded, but the operator schedule controls future runs';
  }

  private static formatInterval(intervalMs: number): string {
    const interval = dayjs.duration(Math.max(1, intervalMs));
    const totalMinutes = dayjs.duration(interval.asMilliseconds()).asMinutes();
    const roundedMinutes = Math.max(1, Math.round(totalMinutes));
    if (roundedMinutes < 60) {
      return `${roundedMinutes}m`;
    }

    const hours = Math.floor(dayjs.duration(roundedMinutes, 'minutes').asHours());
    const minutes = roundedMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
}

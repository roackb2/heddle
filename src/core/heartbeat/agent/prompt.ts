/**
 * Heartbeat runner agent prompt builder.
 *
 * Owns the autonomous heartbeat instructions that are added around a durable
 * task before it is handed to the generic runtime loop.
 */
import type { HeartbeatRunnerAgentRunContext } from './types.js';

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
- Previous run: ${context.previousRunAt ?? 'none'}${context.previousRunId ? ` (${context.previousRunId})` : ''}
- Next scheduled run: ${context.nextRunAt ?? 'not scheduled'}`;
  }

  private static formatInterval(intervalMs: number): string {
    const totalMinutes = Math.max(1, Math.round(intervalMs / 60_000));
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
}

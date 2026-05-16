import type { AgentHeartbeatEvent, HeartbeatSchedulerEvent } from '@/core/heartbeat/index.js';
import { stripHeartbeatDecisionLine } from './summary.js';

export function printAgentLoopEvent(event: AgentHeartbeatEvent) {
  switch (event.type) {
    case 'loop.started':
      process.stdout.write(`[heartbeat] agent started run=${event.runId} model=${event.model}\n`);
      break;
    case 'loop.resumed':
      process.stdout.write(`[heartbeat] agent resumed from=${event.fromCheckpoint} priorTraceEvents=${event.priorTraceEvents}\n`);
      break;
    case 'tool.calling':
      process.stdout.write(`[heartbeat] tool calling step=${event.step} tool=${event.tool}${event.requiresApproval ? ' approval=true' : ''}\n`);
      break;
    case 'tool.completed':
      process.stdout.write(`[heartbeat] tool completed step=${event.step} tool=${event.tool} ok=${event.result.ok} durationMs=${event.durationMs}\n`);
      break;
    case 'assistant.stream':
      if (event.done) {
        process.stdout.write(`[heartbeat] assistant response complete step=${event.step}\n`);
      }
      break;
    case 'heartbeat.decision':
      process.stdout.write(`[heartbeat] decision=${event.decision} outcome=${event.outcome}\n`);
      break;
    case 'checkpoint.saved':
      process.stdout.write(`[heartbeat] checkpoint saved step=${event.step}\n`);
      break;
    case 'escalation.required':
      process.stdout.write(`[heartbeat] escalation required outcome=${event.outcome}\n`);
      break;
    case 'loop.finished':
      process.stdout.write(`[heartbeat] agent finished outcome=${event.outcome}\n`);
      break;
    case 'trace':
      break;
  }
}

export function printSchedulerEvent(event: HeartbeatSchedulerEvent) {
  switch (event.type) {
    case 'heartbeat.scheduler.started':
      process.stdout.write('[heartbeat] scheduler started\n');
      break;
    case 'heartbeat.scheduler.stopped':
      process.stdout.write(`[heartbeat] scheduler stopped reason=${event.reason}\n`);
      break;
    case 'heartbeat.task.due':
      process.stdout.write(`[heartbeat] task due id=${event.taskId}\n`);
      break;
    case 'heartbeat.task.started':
      process.stdout.write(`[heartbeat] task started id=${event.taskId} loadedCheckpoint=${event.loadedCheckpoint} status=${event.status} progress=${event.progress}\n`);
      break;
    case 'heartbeat.task.finished': {
      const { task, result } = event.record;
      process.stdout.write([
        `[heartbeat] task finished id=${event.taskId} decision=${result.decision} outcome=${result.state.outcome} status=${task.state?.status ?? 'waiting'} enabled=${task.enabled} next=${task.schedule.nextRunAt ?? 'none'}`,
        `[heartbeat] progress ${task.state?.progress ?? ''}`,
        result.state.usage ? `[heartbeat] usage input=${result.state.usage.inputTokens} output=${result.state.usage.outputTokens} total=${result.state.usage.totalTokens} requests=${result.state.usage.requests}` : undefined,
        '',
        'Heartbeat summary:',
        stripHeartbeatDecisionLine(result.summary).trim() || result.summary.trim(),
        '',
      ].filter((line): line is string => line !== undefined).join('\n'));
      break;
    }
    case 'heartbeat.task.failed':
      process.stdout.write(`[heartbeat] task failed id=${event.taskId} status=${event.status} error=${event.error} next=${event.nextRunAt ?? 'none'}\n[heartbeat] progress ${event.progress}\n`);
      break;
  }
}

export function printHeartbeatHelp() {
  process.stdout.write([
    'Usage: heddle heartbeat <command>',
    '',
    'Manage and run heartbeat tasks',
    '',
    'Commands:',
    '  task add                 add a heartbeat task',
    '  task list                list heartbeat tasks',
    '  task show <id>           show a heartbeat task',
    '  task enable <id>         enable a heartbeat task',
    '  task disable <id>        disable a heartbeat task',
    '  start                    start the heartbeat scheduler convenience flow',
    '  run                      run due heartbeat tasks once or in a poll loop',
    '  runs list                list heartbeat run records',
    '  runs show <id>           show a heartbeat run record',
    '',
    'Duration examples:',
    '  30s, 15m, 1h, 2d',
    '',
  ].join('\n'));
}

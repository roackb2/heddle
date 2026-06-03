// Legacy v1 compatibility export. Remove when the old `src/cli` command
// entrypoint is retired and heartbeat is imported only from `src/cli-v2`.
export {
  formatDurationMs,
  parseDurationMs,
  parseHeartbeatArgs,
  runHeartbeatCli,
  type HeartbeatCliOptions,
} from '@/cli-v2/commands/heartbeat-command.js';

import type {
  AgentHeartbeatEvent,
  AgentHeartbeatResult,
  RunAgentHeartbeatOptions,
} from '../agent/index.js';

export type HeartbeatRunPublicError = {
  code: 'heartbeat_run_failed';
  message: string;
};

type HeartbeatRunStreamEnvelope = {
  runId: string;
  sequence: number;
  timestamp: string;
};

export type HeartbeatRunStreamItem =
  | (HeartbeatRunStreamEnvelope & {
    kind: 'activity';
    activity: AgentHeartbeatEvent;
  })
  | (HeartbeatRunStreamEnvelope & {
    kind: 'result';
    result: AgentHeartbeatResult;
  })
  | (HeartbeatRunStreamEnvelope & {
    kind: 'cancelled';
    reason: string;
  })
  | (HeartbeatRunStreamEnvelope & {
    kind: 'error';
    error: HeartbeatRunPublicError;
  });

export type HeartbeatRunHandle = {
  runId: string;
  result: Promise<AgentHeartbeatResult>;
  events(): AsyncIterable<HeartbeatRunStreamItem>;
  cancel(): boolean;
};

export type HeartbeatRunner = (
  options: RunAgentHeartbeatOptions,
) => Promise<AgentHeartbeatResult>;

export type HeartbeatRunServiceOptions = {
  createRunId?: () => string;
  now?: () => string;
  runner?: HeartbeatRunner;
};

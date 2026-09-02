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

export type HeartbeatRunContext = {
  runId: string;
  signal: AbortSignal;
};

export type HeartbeatRunResultProjector<Result> = (
  result: AgentHeartbeatResult,
  run: HeartbeatRunContext,
) => Result | Promise<Result>;

export type StartHeartbeatRunInput = RunAgentHeartbeatOptions;

export type StartProjectedHeartbeatRunInput<Result> = RunAgentHeartbeatOptions & {
  /** Runs before the canonical result terminal is published. */
  projectResult: HeartbeatRunResultProjector<Result>;
};

export type HeartbeatRunStreamItem<Result = AgentHeartbeatResult> =
  | (HeartbeatRunStreamEnvelope & {
    kind: 'activity';
    activity: AgentHeartbeatEvent;
  })
  | (HeartbeatRunStreamEnvelope & {
    kind: 'result';
    result: Result;
  })
  | (HeartbeatRunStreamEnvelope & {
    kind: 'cancelled';
    reason: string;
  })
  | (HeartbeatRunStreamEnvelope & {
    kind: 'error';
    error: HeartbeatRunPublicError;
  });

export type HeartbeatRunHandle<Result = AgentHeartbeatResult> = {
  runId: string;
  result: Promise<Result>;
  events(): AsyncIterable<HeartbeatRunStreamItem<Result>>;
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

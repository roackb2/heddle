import type {
  InvokeAgentRuntimeCommand,
  InvokeAgentRuntimeCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore';
import type { AgentCoreExecutionTarget } from './schemas.js';

export interface AgentCoreRuntimeClient {
  send(
    command: InvokeAgentRuntimeCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<InvokeAgentRuntimeCommandOutput>;
  destroy?(): void;
}

export type AgentCoreExecutionHostConfig = AgentCoreExecutionTarget & {
  client?: AgentCoreRuntimeClient;
};

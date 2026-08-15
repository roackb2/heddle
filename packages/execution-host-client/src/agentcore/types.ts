import type {
  InvokeAgentRuntimeCommand,
  InvokeAgentRuntimeCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore';

export interface AgentCoreRuntimeClient {
  send(
    command: InvokeAgentRuntimeCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<InvokeAgentRuntimeCommandOutput>;
  destroy?(): void;
}

export type AgentCoreExecutionHostConfig = {
  region: string;
  runtimeArn: string;
  qualifier?: string;
  client?: AgentCoreRuntimeClient;
};

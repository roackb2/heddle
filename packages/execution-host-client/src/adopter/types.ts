import type { ExecutionHostStreamEvent } from '../contracts/index.js';

export type HostedConversationClientConfig = {
  endpoint?: string | URL;
  fetch?: typeof globalThis.fetch;
};

export type HostedConversationClientTurnInput = {
  prompt: string;
  accessToken: string;
  signal?: AbortSignal;
};

export interface HostedConversationStreamClient {
  streamTurn(
    input: HostedConversationClientTurnInput,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

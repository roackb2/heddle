import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostedHeartbeatDelegationIssuer } from '../types.js';

export type NodeHostedHeartbeatDelegationFailure = {
  phase: 'delegation';
  errorType: string;
};

export type NodeHostedHeartbeatDelegationHttpServiceConfig = {
  delegations: HostedHeartbeatDelegationIssuer;
  apiToken: string;
  path?: string;
  maxBodyBytes?: number;
  /** Receives credential-free operational metadata, never the raw error. */
  reportFailure?: (failure: NodeHostedHeartbeatDelegationFailure) => void;
};

export interface NodeHostedHeartbeatDelegationHttpHandler {
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  handleDelegation(
    request: IncomingMessage,
    response: ServerResponse,
  ): void;
  close(): Promise<void>;
}

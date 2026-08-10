import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import type { ExecutionAuthority } from '../authority/index.js';
import type { ExecutionHostStreamEvent } from '../contracts/index.js';

export type NodeExecutionAdopterAuthenticationInput = {
  authorization?: string;
  remoteAddress?: string;
  signal: AbortSignal;
};

export type NodeExecutionAdopterConversationInput<Principal> = {
  principal: Principal;
  prompt: string;
  signal: AbortSignal;
};

export interface NodeExecutionAdopterAuthenticator<Principal> {
  authenticate(
    input: NodeExecutionAdopterAuthenticationInput,
  ): Principal | undefined | Promise<Principal | undefined>;
}

export interface NodeExecutionAdopterConversationService<Principal> {
  streamTurn(
    input: NodeExecutionAdopterConversationInput<Principal>,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

export type NodeExecutionAdopterPublicError = {
  statusCode: number;
  message: string;
};

export type NodeExecutionAdopterFailure = {
  phase: 'jwks' | 'authentication' | 'conversation';
  errorType: string;
  streamAccepted: boolean;
};

export type NodeExecutionAdopterHttpPaths = {
  jwks: string;
  conversationTurns: string;
};

export type NodeExecutionAdopterHttpServiceConfig<Principal> = {
  authority: Pick<ExecutionAuthority, 'publicJwks'>;
  authenticator: NodeExecutionAdopterAuthenticator<Principal>;
  conversations: NodeExecutionAdopterConversationService<Principal>;
  /** Maps adopter-domain failures to intentionally public HTTP errors. */
  projectError?: (
    error: unknown,
  ) => NodeExecutionAdopterPublicError | undefined;
  /** Receives credential-free operational metadata, never the raw error. */
  reportFailure?: (failure: NodeExecutionAdopterFailure) => void;
  paths?: Partial<NodeExecutionAdopterHttpPaths>;
  maxBodyBytes?: number;
  maxPromptCharacters?: number;
  jwksMaxAgeSeconds?: number;
};

export interface NodeExecutionAdopterHttpHandler {
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  handleJwks(request: IncomingMessage, response: ServerResponse): void;
  handleConversationTurn(
    request: IncomingMessage,
    response: ServerResponse,
  ): void;
  close(): Promise<void>;
}

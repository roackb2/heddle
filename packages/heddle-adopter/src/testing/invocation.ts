import type { ExecutionHostConversationTurnRequest } from '../contracts/index.js';
import type {
  LocalExecutionHostInvocation,
  LocalExecutionHostInvocationMetadata,
} from './types.js';

/** Keeps request-scoped authority out of enumerable object properties. */
export class CredentialBoundLocalInvocation
implements LocalExecutionHostInvocation {
  readonly #request: ExecutionHostConversationTurnRequest;
  readonly #runtimeSessionId: string;
  readonly #signal: AbortSignal;
  readonly #mcpCapability: string | undefined;
  readonly #publishActivity: (activity: unknown) => Promise<void>;

  constructor(input: {
    request: ExecutionHostConversationTurnRequest;
    runtimeSessionId: string;
    signal: AbortSignal;
    mcpCapability?: string;
    publishActivity: (activity: unknown) => Promise<void>;
  }) {
    this.#request = Object.freeze({ ...input.request });
    this.#runtimeSessionId = input.runtimeSessionId;
    this.#signal = input.signal;
    this.#mcpCapability = input.mcpCapability;
    this.#publishActivity = input.publishActivity;
  }

  get request(): ExecutionHostConversationTurnRequest {
    return this.#request;
  }

  get runtimeSessionId(): string {
    return this.#runtimeSessionId;
  }

  get signal(): AbortSignal {
    return this.#signal;
  }

  mcpCapability(): string | undefined {
    return this.#mcpCapability;
  }

  publishActivity(activity: unknown): Promise<void> {
    return this.#publishActivity(activity);
  }

  toJSON(): LocalExecutionHostInvocationMetadata {
    return {
      schemaVersion: this.#request.schemaVersion,
      kind: this.#request.kind,
      invocationId: this.#request.invocationId,
      runtimeSessionId: this.#runtimeSessionId,
    };
  }
}

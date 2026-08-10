export class ExecutionHostProtocolError extends Error {
  readonly name = 'ExecutionHostProtocolError';

  constructor(message = 'Execution Host returned an invalid v1 stream.') {
    super(message);
  }
}

export class ExecutionHostStreamInterruptedError extends Error {
  readonly name = 'ExecutionHostStreamInterruptedError';

  constructor() {
    super('Execution Host stream ended without a terminal event.');
  }
}

export class ExecutionHostInvocationCancelledError extends Error {
  readonly name = 'ExecutionHostInvocationCancelledError';

  constructor() {
    super('Execution Host invocation was cancelled.');
  }
}

export class ExecutionHostRejectedError extends Error {
  readonly name = 'ExecutionHostRejectedError';

  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Execution Host rejected the invocation (${status}, ${code}).`);
  }
}

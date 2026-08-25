import type { JwtVerificationUnavailableCategory } from '../internal/jwt-verification.js';

export class ExecutionIdentityVerificationError extends Error {
  readonly name = 'ExecutionIdentityVerificationError';

  constructor(options?: ErrorOptions) {
    super('Execution identity verification failed.', options);
  }
}

export class ExecutionIdentityUnavailableError extends Error {
  readonly name = 'ExecutionIdentityUnavailableError';

  constructor(
    readonly category: JwtVerificationUnavailableCategory,
    options?: ErrorOptions,
  ) {
    super('Execution identity verification is temporarily unavailable.', options);
  }
}

export class ExecutionHostMcpCapabilityVerificationError extends Error {
  readonly name = 'ExecutionHostMcpCapabilityVerificationError';

  constructor(options?: ErrorOptions) {
    super('MCP capability verification failed.', options);
  }
}

export class ExecutionHostMcpCapabilityUnavailableError extends Error {
  readonly name = 'ExecutionHostMcpCapabilityUnavailableError';

  constructor(
    readonly category: JwtVerificationUnavailableCategory,
    options?: ErrorOptions,
  ) {
    super('MCP capability verification is temporarily unavailable.', options);
  }
}

export class UnexpectedExecutionHostMcpCapabilityError extends Error {
  readonly name = 'UnexpectedExecutionHostMcpCapabilityError';
}

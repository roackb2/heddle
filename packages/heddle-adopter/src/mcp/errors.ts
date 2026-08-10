export class McpCapabilityVerificationError extends Error {
  readonly name = 'McpCapabilityVerificationError';

  constructor() {
    super('MCP capability verification failed.');
  }
}

export type McpCapabilityUnavailableCategory = 'network' | 'jwks';

export class McpCapabilityUnavailableError extends Error {
  readonly name = 'McpCapabilityUnavailableError';

  constructor(readonly category: McpCapabilityUnavailableCategory) {
    super('MCP capability verification is temporarily unavailable.');
  }
}

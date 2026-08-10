export {
  JwtMcpCapabilityVerifier,
  assertMcpCapabilityActive,
} from './jwt-capability-verifier.js';
export {
  McpCapabilityUnavailableError,
  McpCapabilityVerificationError,
} from './errors.js';
export type { McpCapabilityUnavailableCategory } from './errors.js';
export type {
  JwtMcpCapabilityVerifierConfig,
  JwtMcpCapabilityVerifierOptions,
  McpCapabilityVerifier,
  McpInvocationScope,
  VerifiedMcpCapability,
} from './types.js';

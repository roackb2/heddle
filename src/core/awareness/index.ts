export { createAwarenessService } from './service.js';
export {
  appendAwarenessDomainSystemContext,
  buildAwarenessDomainSystemContext,
} from './domain-prompt.js';
export type {
  AwarenessCollectInput,
  AwarenessDomain,
  AwarenessLimit,
  AwarenessProfile,
  AwarenessProvider,
  AwarenessSnapshot,
  AwarenessSource,
} from './types.js';
export { createCodingAwarenessProvider } from './domains/coding/provider.js';
export { formatCodingProjectDashboardSnapshot } from './domains/coding/format.js';
export type {
  CodingAwarenessSection,
  CodingAwarenessSnapshot,
  CodingProjectDashboardOutput,
  CodingWorkingEnvironment,
  CodingWorkspaceTree,
  CodingWorkspaceTreeEntry,
} from './domains/coding/types.js';

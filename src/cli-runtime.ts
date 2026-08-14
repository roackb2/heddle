// Package-to-package boundary used by @heddleagent/cli. Product applications
// should prefer the curated root or advanced runtime entrypoints.

export {
  ProviderCredentialCommandService,
  ProviderCredentialRepository,
} from './core/auth/index.js';
export type { ProviderCredentialCommandOptions } from './core/auth/index.js';

export type { ConversationTurnPresentationTimelineItem } from './core/chat/types.js';

export { runAgentEvalCase } from './core/eval/agent-runner.js';
export { loadEvalCases } from './core/eval/case-loader.js';
export { cleanupEvalResults } from './core/eval/cleanup.js';
export { writeEvalSuiteReport } from './core/eval/report-writer.js';
export type { EvalCase, EvalSuiteReport } from './core/eval/schema.js';

export { DEFAULT_OPENAI_MODEL } from './core/config.js';
export { LlmAdapterService } from './core/llm/index.js';
export type { LlmProvider } from './core/llm/types.js';

export { MemoryCatalogService } from './core/memory/catalog.js';
export { MemoryMaintenanceService } from './core/memory/maintainer.js';
export { MemoryValidationService } from './core/memory/validation.js';
export { MemoryVisibilityService } from './core/memory/visibility.js';
export type { MemoryValidationResult } from './core/memory/types.js';

export { ProjectConfigService } from './core/project-config/index.js';
export {
  FileDaemonRegistryRepository,
  RuntimeDaemonRegistryService,
  RuntimeHostResolver,
} from './core/runtime/daemon/index.js';
export type { ResolvedRuntimeHost } from './core/runtime/daemon/index.js';
export { LlmProviderRuntimeService } from './core/runtime/provider-runtime/index.js';
export { RuntimeWorkspaceService } from './core/runtime/workspaces/index.js';
export { truncate } from './core/utils/text.js';

export {
  ControlPlaneChatSessionPresenter,
  createServerLogger,
  startHeddleControlPlaneServer,
} from './server/index.js';
export type {
  AppRouter,
  HeddleControlPlaneServerHandle,
  HeddleControlPlaneServerOptions,
  HeddleHeartbeatSchedulerSettings,
} from './server/index.js';

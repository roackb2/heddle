// ===========================================================================
// Heddle — Public SDK (curated entry)
// ===========================================================================
// This is the default `@roackb2/heddle` import: the curated surface a product
// host needs to build an agentic experience, organized as a progressive-
// disclosure ladder. Start at the top and go deeper only when you need to.
// Full guide: docs/guides/programmatic/quickstart.md
//
//   1. Start here            — stand up a conversation agent in a few lines
//   • Core types             — the handful of types shared across the ladder
//   2. Add capabilities      — your own tools, MCP servers, skills
//   3. Shape input/output    — render streaming activity / text, read results
//   4. Advanced: lifecycle   — drive the engine, sessions, and approvals
//   5. Advanced: storage     — back sessions/archives/artifacts with your store
//
// Remote-hosting assumptions are explicit peer entrypoints:
// `@roackb2/heddle/hosted` and the lightweight `@roackb2/heddle-remote`
// package.
// Lower-level runtime plumbing (LLM adapters, individual tools, trace, memory,
// models, awareness, the agent loop, heartbeat, integrations, utilities) lives
// behind the `@roackb2/heddle/advanced` subpath — see src/advanced.ts.
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Start here — stand up a conversation agent
// ---------------------------------------------------------------------------
// `ConversationAgentService` is the smallest headless structured agent;
// `runQuickstartConversationCli()` adds a terminal loop. Drop to
// `createConversationEngine(...)` when you want full lifecycle control.
export { ConversationAgentService } from './sdk/conversation/index.js';
export type {
  ConversationAgentCredentialContext,
  ConversationAgentCredentialPreflightOptions,
  ConversationAgentMemoryMaintenanceMode,
  ConversationAgentOptions,
  ConversationAgentRuntimeContext,
  ConversationAgentRuntimeDefaults,
  ConversationAgentRuntimeDefaultsInput,
  ConversationAgentSendInput,
  ConversationAgentSessionOptions,
  ConversationAgentTurnResult,
} from './sdk/conversation/index.js';
export {
  QuickstartConversationCliRunnerService,
  resolveQuickstartConversationCliDefaults,
  runQuickstartConversationCli,
} from './sdk/conversation/index.js';
export type {
  QuickstartConversationCliCredentialContext,
  QuickstartConversationCliCredentialPreflightOptions,
  QuickstartConversationCliLocalCommand,
  QuickstartConversationCliLocalCommandContext,
  QuickstartConversationCliMemoryMaintenanceMode,
  QuickstartConversationCliRunnerDefaults,
  QuickstartConversationCliRunnerDefaultsInput,
  QuickstartConversationCliRunnerOptions,
  QuickstartConversationCliTurnContext,
} from './sdk/conversation/index.js';
export { createConversationEngine } from './core/chat/engine/conversation-engine.js';
export { ConversationPersistenceService } from './core/chat/engine/persistence/index.js';
export { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './core/config.js';

// ---------------------------------------------------------------------------
// Core types — shared across the ladder
// ---------------------------------------------------------------------------
export type {
  RunInput,
  RunFailure,
  RunResult,
  ModelRunFailureCode,
  ToolDefinition,
  ToolExecutionContext,
  ToolCall,
  ToolResult,
  TraceEvent,
  StopReason,
} from './core/types.js';
export type {
  LlmModelUsage,
  LlmUsage,
  LlmUsageCost,
} from './core/llm/types.js';

// Provider-specific credential acquisition remains opt-in. The device-code
// service is useful to hosted adopters that cannot receive a loopback callback.
export { OpenAiDeviceCodeAuthService } from './core/auth/index.js';
export type {
  OpenAiDeviceCodeChallenge,
  OpenAiDeviceCodePollOptions,
  OpenAiDeviceCodePollResult,
  OpenAiDeviceCodeRequestOptions,
} from './core/auth/index.js';

// ---------------------------------------------------------------------------
// 2. Add capabilities — tools, MCP servers, skills
// ---------------------------------------------------------------------------
// Author a tool with the `ToolDefinition` type above; wire an MCP server with
// `prepareMcpHostExtension`; compose host tools/context with
// `defineHostExtension`. Ready-made tools live in `@roackb2/heddle/advanced`.
export {
  defineMcpHostExtension,
  McpHostExtensionService,
  prepareMcpHostExtension,
  prepareMcpHostExtensionCatalog,
} from './core/chat/engine/mcp-host-extension.js';
export type {
  DefineMcpHostExtensionOptions,
  McpHostAutoResultArtifactHint,
  McpHostAutoResultArtifactsOptions,
  McpHostResultArtifactOutput,
  McpHostResultArtifactReference,
  McpHostResultArtifactRule,
  McpHostResultArtifactsOptions,
  McpHostToolOverride,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
} from './core/chat/engine/mcp-host-extension.js';
export { defineHostExtension, ConversationEngineHostExtensionService } from './core/chat/engine/host-extension.js';
export type {
  ConversationEngineHostArtifactOptions,
  ConversationEngineHostMcpOptions,
} from './core/chat/engine/host-extension.js';
export { RuntimeToolService } from './core/runtime/tools/index.js';
export type { DefaultAgentToolsOptions } from './core/runtime/tools/index.js';
export {
  ToolBundleComposer,
  ToolExecutionService,
  ToolRegistry,
} from './core/tools/index.js';
export type { ToolToolkit, ToolToolkitContext } from './core/tools/index.js';
export { artifactsToolkit } from './core/tools/toolkits/artifacts/index.js';
export { AgentSkillService, AgentSkillsRuntimeContextService, FileAgentSkillActivationRepository } from './core/skills/index.js';
export type {
  AppendAgentSkillsSystemContextOptions,
  AgentSkillActivationRecord,
  AgentSkillActivationResult,
  AgentSkillActivationStatus,
  AgentSkillActivationStore,
  AgentSkillActivationStoreOptions,
  AgentSkillActivationStorePort,
  AgentSkillActivationOverview,
  AgentSkillActivationView,
  AgentSkillActivationViewStatus,
  AgentSkillCatalog,
  AgentSkillCatalogEntry,
  AgentSkillCatalogIssue,
  AgentSkillCatalogIssueCode,
  AgentSkillCatalogPromptOptions,
  AgentSkillReadResult,
  AgentSkillResourceReadResult,
  AgentSkillRoot,
  AgentSkillServiceOptions,
  AgentSkillSourceKind,
} from './core/skills/index.js';
export { createReadAgentSkillTool } from './core/tools/toolkits/agent-skills/index.js';
export type { ReadAgentSkillToolOptions } from './core/tools/toolkits/agent-skills/index.js';

// ---------------------------------------------------------------------------
// 3. Shape input/output — render activity/text, read turn results
// ---------------------------------------------------------------------------
// `createConversationTextHost` is the common terminal-style renderer. The
// activity/turn-result types let you build a custom output destination.
export { ConversationTextHostService, createConversationTextHost } from './core/chat/engine/text-host/index.js';
export type {
  ConversationTextHost,
  ConversationTextHostMode,
  ConversationTextHostOptions,
  ConversationTextHostWriter,
} from './core/chat/engine/text-host/index.js';
export type {
  ConversationActivity,
  ConversationActivityCorrelation,
  ConversationActivityDerived,
  ConversationActivityHandlerMap,
  ConversationActivityOf,
  ConversationCompactionStatus,
  ToolCallSummaryInput,
  ToolResultSummaryOptions,
  ToolSummaryOptions,
} from './core/chat/engine/index.js';
export { HeddleEventType } from './core/event-types.js';
export type { HeddleEventTypeValue } from './core/event-types.js';
export type {
  ConversationTurnResultSummary,
  ConversationTurnToolResult,
} from './core/chat/engine/turn-result.js';
export { ToolActivitySummarizer } from './core/live/index.js';

// ---------------------------------------------------------------------------
// 4. Advanced: engine lifecycle, sessions & approvals
// ---------------------------------------------------------------------------
// Types and services for hosts that embed `createConversationEngine` (rung 1)
// directly and manage session create/resume/turn lifecycle and approval policy
// themselves.
export {
  ConversationRunCancelledError,
  ConversationRunConflictError,
  ConversationRunNotFoundError,
  ConversationRunReplayUnavailableError,
  ConversationRunService,
} from './core/chat/runs/index.js';
export type {
  ConversationRunAccepted,
  ConversationRunAddress,
  ConversationRunContext,
  ConversationRunHandle,
  ConversationTurnResultProjector,
  ConversationRunReplayOptions,
  ConversationRunServiceOptions,
  ConversationRunStreamItem,
  PendingConversationRunApproval,
  StartConversationContinueRunInput,
  StartConversationRunInput,
  StartConversationTurnRunInput,
  StartProjectedConversationContinueRunInput,
  StartProjectedConversationTurnRunInput,
  SubscribeConversationRunInput,
} from './core/chat/runs/index.js';
export type {
  ClearConversationTurnLeaseInput,
  ConversationEngine,
  ConversationEngineConfig,
  ConversationEngineHost,
  ConversationEngineHostExtension,
  ConversationEngineHostExtensions,
  ConversationEngineHostExtensionsInput,
  ConversationSessionService,
  ConversationTurnService,
  CreateConversationSessionInput,
  ContinueConversationTurnInput,
  EnsureConversationSessionInput,
  EnsureConversationSessionResult,
  SubmitConversationTurnInput,
  SubmitConversationTurnResult,
  UpdateConversationSessionSettingsInput,
} from './core/chat/engine/types.js';
export type {
  ConversationPersistence,
  ConversationPersistenceConfiguration,
  ConversationPersistenceReadinessCheck,
  ConversationPersistenceReadinessCheckId,
  ConversationPersistenceReadinessIssue,
  ConversationPersistenceReadinessIssueCode,
  ConversationPersistenceReadinessReport,
  ConversationPersistenceReadinessSource,
  ConversationPersistenceTargetLevel,
  HeddlePersistenceCapabilities,
  ResolvedConversationPersistence,
  ResolvedHeddlePersistenceCapabilities,
} from './core/chat/engine/persistence/index.js';
export { EngineConversationTurnService } from './core/chat/engine/turns/service.js';
export type { RuntimeToolSelectionProfile, ToolCapability } from './core/runtime/tools/index.js';
export type {
  RunConversationTurnArgs,
  RunConversationTurnResult,
} from './core/chat/engine/turns/types.js';
export {
  ToolApprovalPolicies,
  ToolApprovalService,
} from './core/approvals/index.js';
export type { ToolApprovalServiceOptions } from './core/approvals/index.js';
export {
  ProjectApprovalRuleCodec,
  ProjectApprovalRules,
} from './core/approvals/remembered-rules/index.js';
export type {
  EvaluateToolApprovalPoliciesArgs,
  RequestToolApprovalThroughServiceArgs,
  ResolveToolApprovalArgs,
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalPolicyContext,
  ToolApprovalPolicyDecision,
  ToolApprovalRequest,
  ToolApprovalSurface,
  ToolApprovalUserDecision,
} from './core/approvals/types.js';
export type {
  ApprovalMode,
  ApprovalRuleTool,
  ProjectApprovalRule,
} from './core/approvals/remembered-rules/index.js';

// ---------------------------------------------------------------------------
// 5. Advanced: storage — back Heddle with your own persistence
// ---------------------------------------------------------------------------
// Heddle defaults to local file-backed stores. Artifacts, sessions, and
// compacted conversation archives are injectable: implement the corresponding
// repository and pass it to `createConversationEngine(...)` (or the quickstart
// runner). Traces and memory remain path-oriented (`stateRoot`) for now.
export { ArtifactService, FileArtifactRepository } from './core/artifacts/index.js';
export type {
  ArtifactCurrentPointers,
  ArtifactKind,
  ArtifactListOptions,
  ArtifactReadResult,
  ArtifactRepository,
  ArtifactServiceOptions,
  ArtifactStore,
  FileArtifactRepositoryOptions,
  RuntimeArtifact,
  SaveTextArtifactInput,
} from './core/artifacts/index.js';
export {
  ChatSessionCatalogPagination,
  ChatSessionAlreadyExistsError,
  ChatSessionPersistenceCodec,
  ChatSessionRepositoryConformance,
  ChatSessionRepositoryConformanceError,
  ChatSessionRevisionConflictError,
  ChatSessionStorageCorruptionError,
  FileChatSessionRepository,
  InvalidChatSessionCursorError,
} from './core/chat/engine/sessions/repository/index.js';
export type {
  ChatSessionCatalog,
  ChatSessionCatalogCursor,
  ChatSessionCatalogEntry,
  ChatSessionCatalogPage,
  ChatSessionRepository,
  ChatSessionRepositoryConformanceHarness,
  ChatSessionRepositoryConformanceScenario,
  CorruptChatSessionRecordInput,
  DeleteChatSessionInput,
  ListChatSessionsInput,
  SessionStoragePaths,
  StoredChatSession,
  UpdateChatSessionInput,
} from './core/chat/engine/sessions/repository/index.js';
export {
  ChatArchivePersistenceCodec,
  ChatArchiveStorageCorruptionError,
  ChatArchiveSummaryNotFoundError,
  ChatArchiveRepositoryError,
  FileChatArchiveRepository,
} from './core/chat/engine/sessions/archives/index.js';
export type {
  AppendChatArchiveInput,
  AppendChatArchiveResult,
  ChatArchiveRecordDraft,
  ChatArchiveRepository,
  ChatArchiveStoragePaths,
  FileChatArchiveRepositoryOptions,
  ChatArchiveRepositoryOperation,
} from './core/chat/engine/sessions/archives/index.js';
export type {
  ChatArchiveManifest,
  ChatArchiveRecord,
  ChatSession,
} from './core/chat/types.js';
export { RuntimeCredentialService } from './core/runtime/credentials/index.js';
export type {
  ApiKeyRuntime,
  ProviderCredentialSource,
  RuntimeProviderCredential,
} from './core/runtime/credentials/index.js';

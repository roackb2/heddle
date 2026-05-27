import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/router.js';

// Interface code imports API contracts from this shared client boundary. Keep
// AppRouter type imports isolated here so web-v2, TUI, and CLI code never reach
// into server controllers or core services directly.
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

type AsyncIterableValue<T> = T extends AsyncIterable<infer Value> ? Value : T;

export type ControlPlaneState = RouterOutputs['controlPlane']['state'];
export type ControlPlaneSessions = RouterOutputs['controlPlane']['sessions'];
export type ControlPlaneSessionView = ControlPlaneSessions['sessions'][number];
export type ControlPlaneSessionDetail = RouterOutputs['controlPlane']['session'];
export type ControlPlaneSessionEventEnvelope = AsyncIterableValue<RouterOutputs['controlPlane']['sessionEvents']>;
export type ControlPlaneSessionsEventEnvelope = AsyncIterableValue<RouterOutputs['controlPlane']['sessionsEvents']>;
export type ControlPlaneHeartbeatEventEnvelope = AsyncIterableValue<RouterOutputs['controlPlane']['heartbeatEvents']>;
export type ControlPlaneSessionMessage = NonNullable<ControlPlaneSessionDetail>['messages'][number];
export type ControlPlanePendingApproval = RouterOutputs['controlPlane']['sessionPendingApproval'];
export type ControlPlaneApprovalDecision = RouterInputs['controlPlane']['sessionResolveApproval']['decision'];
export type ControlPlaneSessionSendPromptResult = RouterOutputs['controlPlane']['sessionSendPrompt'];
export type ControlPlaneSessionSendPromptAsyncResult = RouterOutputs['controlPlane']['sessionSendPromptAsync'];
export type ControlPlaneModelOptions = RouterOutputs['controlPlane']['modelOptions'];
export type ControlPlaneSessionSettingsInput = RouterInputs['controlPlane']['sessionSettingsUpdate'];
export type ControlPlaneHeartbeatTasks = RouterOutputs['controlPlane']['heartbeatTasks'];
export type ControlPlaneHeartbeatTask = RouterOutputs['controlPlane']['heartbeatTask'];
export type ControlPlaneHeartbeatTaskCreate = RouterOutputs['controlPlane']['heartbeatTaskCreate'];
export type ControlPlaneHeartbeatTaskUpdate = RouterOutputs['controlPlane']['heartbeatTaskUpdate'];
export type ControlPlaneHeartbeatTaskDelete = RouterOutputs['controlPlane']['heartbeatTaskDelete'];
export type ControlPlaneHeartbeatTaskResume = RouterOutputs['controlPlane']['heartbeatTaskResume'];
export type ControlPlaneHeartbeatTaskView = ControlPlaneHeartbeatTasks['tasks'][number];
export type ControlPlaneHeartbeatRunView = ControlPlaneHeartbeatTask['runs'][number];
export type ControlPlaneHeartbeatRun = RouterOutputs['controlPlane']['heartbeatRun'];
export type ControlPlaneHeartbeatTaskRunNow = RouterOutputs['controlPlane']['heartbeatTaskRunNow'];
export type ControlPlaneMemoryStatus = RouterOutputs['controlPlane']['memoryStatus'];
export type ControlPlaneWorkspaceChanges = RouterOutputs['controlPlane']['workspaceChanges'];
export type ControlPlaneWorkspaceChangedFile = ControlPlaneWorkspaceChanges['files'][number];
export type ControlPlaneWorkspaceFileDiff = RouterOutputs['controlPlane']['workspaceFileDiff'];

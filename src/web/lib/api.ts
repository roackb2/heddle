import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../server/router';

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
    }),
  ],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type ControlPlaneState = RouterOutputs['controlPlane']['state'];
export type ChatSessionDetail = RouterOutputs['controlPlane']['session'];
export type CreatedChatSession = RouterOutputs['controlPlane']['sessionCreate'];
export type ChatTurnReview = RouterOutputs['controlPlane']['sessionTurnReview'];
export type SessionSendPromptResult = RouterOutputs['controlPlane']['sessionSendPrompt'];
export type SessionContinueResult = RouterOutputs['controlPlane']['sessionContinue'];
export type PendingSessionApproval = RouterOutputs['controlPlane']['sessionPendingApproval'];
export type SessionRunningState = RouterOutputs['controlPlane']['sessionRunning'];
export type WorkspaceFileSuggestion = RouterOutputs['controlPlane']['workspaceFileSearch']['files'][number];
export type WorkspaceDirectoryListing = RouterOutputs['controlPlane']['workspaceBrowse'];
export type WorkspaceChanges = RouterOutputs['controlPlane']['workspaceChanges'];
export type WorkspaceFileDiff = RouterOutputs['controlPlane']['workspaceFileDiff'];
export type ModelOptions = RouterOutputs['controlPlane']['modelOptions'];
export type SavedLayoutSnapshot = RouterOutputs['controlPlane']['layoutSnapshotSave'];
export type HeartbeatTaskMutationResult = RouterOutputs['controlPlane']['heartbeatTaskEnable'];
export type WorkspaceMutationResult = RouterOutputs['controlPlane']['workspaceSetActive'];

export async function fetchControlPlaneState(): Promise<ControlPlaneState> {
  return await trpc.controlPlane.state.query();
}

export async function fetchChatSessionDetail(sessionId: string): Promise<ChatSessionDetail> {
  return await trpc.controlPlane.session.query({ id: sessionId });
}

export async function fetchModelOptions(): Promise<ModelOptions> {
  return await trpc.controlPlane.modelOptions.query();
}

export async function updateChatSessionSettings(
  sessionId: string,
  settings: { model?: string; driftEnabled?: boolean },
): Promise<Exclude<ChatSessionDetail, null>> {
  return await trpc.controlPlane.sessionSettingsUpdate.mutate({ id: sessionId, ...settings });
}

export async function createChatSession(name?: string): Promise<CreatedChatSession> {
  return await trpc.controlPlane.sessionCreate.mutate(name ? { name } : undefined);
}

export async function fetchChatTurnReview(sessionId: string, turnId: string): Promise<ChatTurnReview> {
  return await trpc.controlPlane.sessionTurnReview.query({ sessionId, turnId });
}

export async function sendChatSessionPrompt(sessionId: string, prompt: string): Promise<SessionSendPromptResult> {
  return await trpc.controlPlane.sessionSendPrompt.mutate({ sessionId, prompt });
}

export async function continueChatSession(sessionId: string): Promise<SessionContinueResult> {
  return await trpc.controlPlane.sessionContinue.mutate({ id: sessionId });
}

export async function fetchPendingSessionApproval(sessionId: string): Promise<PendingSessionApproval> {
  return await trpc.controlPlane.sessionPendingApproval.query({ id: sessionId });
}

export async function fetchSessionRunningState(sessionId: string): Promise<SessionRunningState> {
  return await trpc.controlPlane.sessionRunning.query({ id: sessionId });
}

export async function cancelChatSession(sessionId: string): Promise<{ cancelled: boolean }> {
  return await trpc.controlPlane.sessionCancel.mutate({ id: sessionId });
}

export async function resolvePendingSessionApproval(
  sessionId: string,
  approved: boolean,
  reason?: string,
): Promise<{ resolved: boolean }> {
  return await trpc.controlPlane.sessionResolveApproval.mutate({ sessionId, approved, reason });
}

export async function fetchWorkspaceFileSuggestions(query: string): Promise<WorkspaceFileSuggestion[]> {
  const result = await trpc.controlPlane.workspaceFileSearch.query({ query, limit: 20 });
  return result.files;
}

export async function browseWorkspaceDirectories(path?: string, includeHidden = false): Promise<WorkspaceDirectoryListing> {
  return await trpc.controlPlane.workspaceBrowse.query(path ? { path, limit: 100, includeHidden } : { limit: 100, includeHidden });
}

export async function fetchWorkspaceChanges(): Promise<WorkspaceChanges> {
  return await trpc.controlPlane.workspaceChanges.query();
}

export async function fetchWorkspaceFileDiff(path: string): Promise<WorkspaceFileDiff> {
  return await trpc.controlPlane.workspaceFileDiff.query({ path });
}

export async function saveLayoutSnapshot(snapshot: unknown): Promise<SavedLayoutSnapshot> {
  return await trpc.controlPlane.layoutSnapshotSave.mutate({ snapshot });
}

export async function enableHeartbeatTask(taskId: string): Promise<HeartbeatTaskMutationResult> {
  return await trpc.controlPlane.heartbeatTaskEnable.mutate({ taskId });
}

export async function disableHeartbeatTask(taskId: string): Promise<HeartbeatTaskMutationResult> {
  return await trpc.controlPlane.heartbeatTaskDisable.mutate({ taskId });
}

export async function triggerHeartbeatTask(taskId: string): Promise<HeartbeatTaskMutationResult> {
  return await trpc.controlPlane.heartbeatTaskTrigger.mutate({ taskId });
}

export async function setActiveWorkspace(workspaceId: string): Promise<WorkspaceMutationResult> {
  return await trpc.controlPlane.workspaceSetActive.mutate({ workspaceId });
}

export async function createWorkspace(input: {
  name: string;
  anchorRoot: string;
  repoRoots?: string[];
  setActive?: boolean;
}): Promise<WorkspaceMutationResult> {
  return await trpc.controlPlane.workspaceCreate.mutate(input);
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceMutationResult> {
  return await trpc.controlPlane.workspaceRename.mutate({ workspaceId, name });
}

type SessionEventEnvelope = {
  type: string;
  sessionId: string;
  timestamp?: string;
  event?: unknown;
};

export function subscribeToChatSessionEvents(
  sessionId: string,
  onUpdate: (event: SessionEventEnvelope) => void,
): () => void {
  const source = new EventSource(`/control-plane/sessions/${encodeURIComponent(sessionId)}/events`);
  const handle = (type: string) => (event: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(event.data) as { sessionId?: string; timestamp?: string; event?: unknown };
      onUpdate({
        type,
        sessionId: parsed.sessionId ?? sessionId,
        timestamp: parsed.timestamp,
        event: parsed.event,
      });
    } catch {
      onUpdate({ type, sessionId });
    }
  };

  source.addEventListener('ready', handle('ready'));
  source.addEventListener('waiting', handle('waiting'));
  source.addEventListener('heartbeat', handle('heartbeat'));
  source.addEventListener('session.updated', handle('session.updated'));
  source.addEventListener('session.event', handle('session.event'));

  return () => {
    source.close();
  };
}

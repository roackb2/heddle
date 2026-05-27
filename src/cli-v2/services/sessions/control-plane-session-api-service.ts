import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type {
  ControlPlaneApprovalDecision,
  RouterInputs,
} from '@/client-shared/api/types.js';

export type ControlPlaneSessionCreateInput = Exclude<NonNullable<RouterInputs['controlPlane']['sessionCreate']>, void>;
type SessionSendPromptInput = RouterInputs['controlPlane']['sessionSendPrompt'];
type SessionSendPromptAsyncInput = RouterInputs['controlPlane']['sessionSendPromptAsync'];

export type ControlPlaneSessionApiServiceOptions = {
  client: ControlPlaneProxyClient;
  defaultModel?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  apiKey?: string;
  preferApiKey?: boolean;
};

/**
 * Owns cli-v2 control-plane API calls that require terminal runtime defaults.
 */
export class ControlPlaneSessionApiService {
  private readonly client: ControlPlaneProxyClient;
  private readonly defaults: Omit<ControlPlaneSessionApiServiceOptions, 'client'>;

  constructor(options: ControlPlaneSessionApiServiceOptions) {
    this.client = options.client;
    this.defaults = {
      defaultModel: options.defaultModel,
      maxSteps: options.maxSteps,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
    };
  }

  async resolveWorkspaceId(workspaceId?: string): Promise<string> {
    const state = await this.client.controlPlane.state.query(workspaceId ? { workspaceId } : undefined);
    const resolvedWorkspaceId = workspaceId ?? state.activeWorkspaceId;
    if (!resolvedWorkspaceId) {
      throw new Error('No active Heddle workspace is available from the control-plane API.');
    }

    return resolvedWorkspaceId;
  }

  async listSessions(workspaceId: string) {
    const result = await this.client.controlPlane.sessions.query({ workspaceId });
    return result.workspaceId === workspaceId ? result.sessions : [];
  }

  async createSession(workspaceId: string, input: ControlPlaneSessionCreateInput = {}) {
    return this.client.controlPlane.sessionCreate.mutate({
      ...input,
      workspaceId,
      model: input.model ?? this.defaults.defaultModel,
    });
  }

  async getSession(workspaceId: string, sessionId: string) {
    return this.client.controlPlane.session.query({ id: sessionId, workspaceId });
  }

  async getRunning(workspaceId: string, sessionId: string) {
    return this.client.controlPlane.sessionRunning.query({ id: sessionId, workspaceId });
  }

  async getRunState(workspaceId: string, sessionId: string) {
    return this.client.controlPlane.sessionRunState.query({ id: sessionId, workspaceId });
  }

  async getPendingApproval(workspaceId: string, sessionId: string) {
    return this.client.controlPlane.sessionPendingApproval.query({ id: sessionId, workspaceId });
  }

  async sendPrompt(input: Pick<SessionSendPromptInput, 'workspaceId' | 'sessionId' | 'prompt'>) {
    return this.client.controlPlane.sessionSendPrompt.mutate({
      ...input,
      maxSteps: this.defaults.maxSteps,
      searchIgnoreDirs: this.defaults.searchIgnoreDirs,
      apiKey: this.defaults.apiKey,
      preferApiKey: this.defaults.preferApiKey,
      systemContext: this.defaults.systemContext,
    });
  }

  async sendPromptAsync(input: Pick<SessionSendPromptAsyncInput, 'workspaceId' | 'sessionId' | 'prompt'>) {
    return this.client.controlPlane.sessionSendPromptAsync.mutate({
      ...input,
      maxSteps: this.defaults.maxSteps,
      searchIgnoreDirs: this.defaults.searchIgnoreDirs,
      apiKey: this.defaults.apiKey,
      preferApiKey: this.defaults.preferApiKey,
      systemContext: this.defaults.systemContext,
    });
  }

  async cancelRun(workspaceId: string, sessionId: string) {
    return this.client.controlPlane.sessionCancel.mutate({ id: sessionId, workspaceId });
  }

  async resolvePendingApproval(
    workspaceId: string,
    sessionId: string,
    decision: ControlPlaneApprovalDecision,
  ) {
    return this.client.controlPlane.sessionResolveApproval.mutate({
      workspaceId,
      sessionId,
      decision,
    });
  }
}

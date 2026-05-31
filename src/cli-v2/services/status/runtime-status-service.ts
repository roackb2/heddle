import type { ControlPlaneSessionRuntimeContext } from '@/client-shared/api/types.js';
import type { ControlPlaneSessionStoreSnapshot } from '../../state/control-plane-session-store.js';

export class RuntimeStatusService {
  static build(snapshot: ControlPlaneSessionStoreSnapshot): string {
    const context = snapshot.runtimeContext;
    if (!context) {
      return snapshot.workspaceId ? 'runtime context loading...' : 'workspace loading...';
    }

    return [
      `model=${context.model}`,
      `reasoning=${RuntimeStatusService.formatReasoning(context)}`,
      RuntimeStatusService.formatAuth(context),
      RuntimeStatusService.formatContextWindow(context),
      `drift=${context.driftEnabled ? context.driftLevel ?? 'unknown' : 'off'}`,
      `session=${context.sessionId} (${context.sessionName})`,
      snapshot.running ? 'status=running' : undefined,
    ].filter((item): item is string => Boolean(item)).join(' • ');
  }

  private static formatReasoning(context: ControlPlaneSessionRuntimeContext): string {
    if (!context.reasoningSupported) {
      return 'unsupported';
    }

    return context.effectiveReasoningEffort ?? 'default';
  }

  private static formatAuth(context: ControlPlaneSessionRuntimeContext): string {
    const source = context.credentialSource;
    switch (source.type) {
      case 'explicit-api-key':
        return 'auth=explicit-key';
      case 'env-api-key':
        return `auth=${source.provider}-key`;
      case 'oauth':
        return `auth=${source.provider}-oauth`;
      case 'missing':
        return `auth=missing-${source.provider}`;
    }
  }

  private static formatContextWindow(context: ControlPlaneSessionRuntimeContext): string {
    if (!context.contextWindow) {
      return context.estimatedInputTokens
        ? `estimated input tokens ${context.estimatedInputTokens.toLocaleString()}`
        : 'context window unknown';
    }

    if (!context.estimatedInputTokens) {
      return `context window ~${context.contextWindow.toLocaleString()} tokens`;
    }

    const percent = Math.round(Math.min(1, context.estimatedInputTokens / context.contextWindow) * 100);
    return `estimated input ${context.estimatedInputTokens.toLocaleString()} / ${context.contextWindow.toLocaleString()} tokens (${percent}%)`;
  }
}

import { useMemo } from 'react';
import { estimateBuiltInContextWindow } from '../../../core/llm/openai-models.js';
import type { ProviderCredentialSource } from '../utils/runtime.js';
import type { ResolvedRuntimeHost } from '../../../core/runtime/runtime-hosts.js';
import { currentActivityText } from '../utils/format.js';
import type { ApprovalChoice, LiveEvent, PendingApproval } from '../state/types.js';
import type { PlanItem } from '../../../core/tools/toolkits/internal/update-plan.js';

type ActiveTurnSummary = {
  title: string;
  lines: string[];
  error?: string;
  currentAssistantText?: string;
  currentPlan?: {
    explanation?: string;
    items: PlanItem[];
  };
};

export function useChatStatusSummary(args: {
  activeModel: string;
  activeSessionId: string;
  activeSession?: {
    id: string;
    name: string;
    context?: {
      compactionStatus?: 'idle' | 'running' | 'failed';
      lastRunInputTokens?: number;
      estimatedRequestTokens?: number;
    };
  };
  runtimeHostWarningSource?: ResolvedRuntimeHost;
  status: string;
  isRunning: boolean;
  isMemoryUpdating: boolean;
  error?: string;
  liveEvents: LiveEvent[];
  elapsedSeconds: number;
  pendingApproval?: PendingApproval;
  approvalChoice: ApprovalChoice;
  interruptRequested: boolean;
  currentAssistantText?: string;
  currentPlan?: {
    explanation?: string;
    items: PlanItem[];
  };
  workingFrame: number;
  workingFrames: readonly string[];
  credentialSource: ProviderCredentialSource;
}) {
  return useMemo(() => {
    const compacting = args.activeSession?.context?.compactionStatus === 'running';
    const activityText = currentActivityText(
      args.liveEvents,
      args.isRunning,
      args.elapsedSeconds,
      args.pendingApproval,
      args.interruptRequested,
    );
    const contextStatus = formatContextStatus(
      args.activeModel,
      args.activeSession?.context?.lastRunInputTokens ?? args.activeSession?.context?.estimatedRequestTokens,
    );
    const authStatus = formatAuthStatus(args.credentialSource);
    const sessionFooter = `session=${args.activeSession?.id ?? args.activeSessionId}${args.activeSession?.name ? ` (${args.activeSession.name})` : ''}`;
    const renderedStatus =
      args.pendingApproval ? 'awaiting approval'
      : compacting ? `compacting${args.workingFrames[args.workingFrame] ?? '...'}`
      : args.interruptRequested ? 'interrupt requested'
      : args.isRunning ? 'running'
      : args.isMemoryUpdating ? 'memory updating'
      : args.status;
    const statusHint =
      args.pendingApproval ? '←/→ choose • Enter confirms • A remembers for this project • Esc denies • Ctrl+C exits'
      : compacting ? 'Compacting archived history in the background • Ctrl+C exits'
      : args.isRunning ? 'Type freely • Enter queues prompt • Esc requests stop after the current step • Ctrl+C exits'
      : args.isMemoryUpdating ? 'Memory maintenance is running in the background • Enter sends • Ctrl+C exits'
      : 'Enter sends • Tab completes slash commands • /help shows commands • !command runs shell • Ctrl+C exits';
    const runtimeHostWarning =
      args.runtimeHostWarningSource?.kind === 'daemon' && !args.runtimeHostWarningSource.stale ?
        `Daemon is also attached to this workspace at http://${args.runtimeHostWarningSource.endpoint.host}:${args.runtimeHostWarningSource.endpoint.port}. Different sessions are fine; avoid writing to the same session from multiple clients.`
      : undefined;
    const activityLines = args.liveEvents
      .slice(-4)
      .filter((event, index, events) => events.findIndex((candidate) => candidate.text === event.text) === index)
      .map((event, index, events) => {
        if (args.isRunning && index === events.length - 1) {
          return `${event.text} · ${args.elapsedSeconds}s`;
        }

        return event.text;
      });
    const activeTurn: ActiveTurnSummary | undefined =
      args.isRunning || args.pendingApproval || args.interruptRequested || args.error ?
        {
          title:
            args.pendingApproval ? activityText
            : args.error ? 'Recent activity before failure'
            : args.isRunning ? 'Recent activity'
            : activityText,
          lines:
            args.pendingApproval ? activityLines.filter((line) => line !== activityText)
            : activityLines,
          error: args.error,
          currentAssistantText: args.currentAssistantText,
          currentPlan: args.currentPlan,
        }
      : undefined;

    return {
      compacting,
      activityText,
      contextStatus,
      authStatus,
      sessionFooter,
      renderedStatus,
      statusHint,
      runtimeHostWarning,
      activityLines,
      activeTurn,
    };
  }, [args]);
}

function formatContextStatus(model: string, estimatedTokens: number | undefined): string {
  const window = estimateBuiltInContextWindow(model);
  if (!window) {
    return estimatedTokens ? `estimated input tokens ${estimatedTokens}` : 'context window unknown';
  }

  if (!estimatedTokens) {
    return `context window ~${window.toLocaleString()} tokens`;
  }

  const ratio = Math.min(1, estimatedTokens / window);
  const percent = Math.round(ratio * 100);
  return `estimated input ${estimatedTokens.toLocaleString()} / ${window.toLocaleString()} tokens (${percent}%)`;
}

function formatAuthStatus(source: ProviderCredentialSource): string {
  switch (source.type) {
    case 'explicit-api-key':
      return 'auth=explicit-key';
    case 'env-api-key':
      return `auth=${source.provider}-key`;
    case 'oauth':
      return source.accountId ? `auth=${source.provider}-oauth:${source.accountId.slice(0, 8)}` : `auth=${source.provider}-oauth`;
    case 'missing':
      return `auth=missing-${source.provider}`;
  }
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationRunConsumerService } from '../../../../../src/core/chat/remote/index.js';
import type {
  HostedAgentConversation,
  HostedAgentRunEvent,
} from '../../02-http-sse-api/contracts.js';
import { appendHostedAgentActivity } from './activity-feed.js';
import { resolveHostedAgentBrowserStorage } from './browser-storage.js';
import { HostedAgentUiClient } from './hosted-agent-ui-client.js';
import {
  clearHostedAgentRunCheckpoint,
  readHostedAgentRunCheckpoint,
  writeHostedAgentRunCheckpoint,
  type HostedAgentActivityView,
} from './run-checkpoint.js';

type HostedAgentRunReference = { runId: string };

export type UseHostedConversationResult = {
  conversation?: HostedAgentConversation;
  activities: HostedAgentActivityView[];
  liveAssistantText: string;
  error?: string;
  recoveryWarning?: string;
  isLoading: boolean;
  isRunning: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isResetting: boolean;
  submit(prompt: string): Promise<boolean>;
  stop(): Promise<void>;
  reset(): Promise<void>;
  retryConnection(): void;
};

export function useHostedConversation(
  client: HostedAgentUiClient,
  sessionId: string,
): UseHostedConversationResult {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => hostedConversationQueryKey(sessionId), [sessionId]);
  const storage = useMemo(resolveHostedAgentBrowserStorage, []);
  const conversationQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => client.readConversation(sessionId, signal),
  });
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [activities, setActivities] = useState<HostedAgentActivityView[]>([]);
  const [error, setError] = useState<string>();
  const [recoveryWarning, setRecoveryWarning] = useState<string>();
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const activeRunId = conversationQuery.data?.activeRun?.runId;

  useEffect(() => {
    if (!conversationQuery.isSuccess) {
      return;
    }
    if (!activeRunId) {
      setLiveAssistantText('');
      setRecoveryWarning(clearHostedAgentRunCheckpoint(storage, sessionId)
        ? undefined
        : 'Run recovery storage is unavailable in this browser.');
      return;
    }

    const subscription = new AbortController();
    const restored = readHostedAgentRunCheckpoint(storage, sessionId);
    const checkpoint = restored.checkpoint?.runId === activeRunId
      ? restored.checkpoint
      : undefined;
    setRecoveryWarning(restored.storageAvailable
      ? undefined
      : 'Run recovery storage is unavailable in this browser.');

    let assistantText = checkpoint?.assistantText ?? '';
    let activityViews = checkpoint?.activities ?? [];
    let reachedTerminal = false;
    setLiveAssistantText(assistantText);
    setActivities(activityViews);
    setError(undefined);

    const consumer = new ConversationRunConsumerService<HostedAgentRunReference>({
      retry: { maxAttempts: 5, baseDelayMs: 300, maxDelayMs: 3_000 },
    });
    consumer.select(
      { runId: activeRunId },
      { afterSequence: checkpoint?.afterSequence ?? 0 },
    );

    const persistCheckpoint = () => {
      const input = consumer.subscriptionInput();
      if (!input) {
        return;
      }
      const stored = writeHostedAgentRunCheckpoint(storage, sessionId, {
        runId: activeRunId,
        afterSequence: input.afterSequence,
        assistantText,
        activities: activityViews,
      });
      setRecoveryWarning(stored
        ? undefined
        : 'Run recovery storage is unavailable in this browser.');
    };

    const handleEvent = async (event: HostedAgentRunEvent) => {
      const acceptance = consumer.accept(event);
      if (!acceptance.accepted) {
        return;
      }
      if (event.kind === 'activity') {
        if (event.activity.type === 'assistant.stream' && event.activity.text !== undefined) {
          assistantText = event.activity.text;
          setLiveAssistantText(assistantText);
        }
        activityViews = appendHostedAgentActivity(activityViews, event);
        setActivities(activityViews);
      }

      if (!acceptance.terminal) {
        persistCheckpoint();
        return;
      }

      reachedTerminal = true;
      clearHostedAgentRunCheckpoint(storage, sessionId);
      queryClient.setQueryData<HostedAgentConversation>(queryKey, (current) => (
        current ? { ...current, activeRun: undefined } : current
      ));
      try {
        const refreshed = await client.readConversation(sessionId);
        queryClient.setQueryData(queryKey, refreshed);
      } catch (refreshError) {
        setError(`Run completed, but the conversation could not refresh: ${formatError(refreshError)}`);
      } finally {
        setLiveAssistantText('');
      }
    };

    const consume = async () => {
      let lastError: unknown;
      while (!subscription.signal.aborted && !reachedTerminal) {
        const input = consumer.subscriptionInput();
        if (!input) {
          return;
        }
        try {
          await client.runs.subscribe({
            ...input,
            signal: subscription.signal,
            onEvent: handleEvent,
          });
          if (!reachedTerminal) {
            lastError = new Error('The event stream ended before a terminal event.');
          }
        } catch (streamError) {
          if (subscription.signal.aborted) {
            return;
          }
          lastError = streamError;
        }

        if (reachedTerminal) {
          return;
        }
        const retry = consumer.nextRetry();
        if (!retry) {
          setError(`Run connection stopped: ${formatError(lastError)}`);
          return;
        }
        await waitForRetry(retry.delayMs, subscription.signal);
      }
    };

    void consume().catch((streamError: unknown) => {
      if (!subscription.signal.aborted) {
        setError(`Run connection failed: ${formatError(streamError)}`);
      }
    });

    return () => subscription.abort();
  }, [
    activeRunId,
    client,
    connectionRevision,
    conversationQuery.isSuccess,
    queryKey,
    queryClient,
    sessionId,
    storage,
  ]);

  const submit = async (prompt: string): Promise<boolean> => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || conversationQuery.data?.activeRun || isStarting) {
      return false;
    }
    setIsStarting(true);
    setError(undefined);
    setActivities([]);
    setLiveAssistantText('');
    clearHostedAgentRunCheckpoint(storage, sessionId);
    try {
      const accepted = await client.runs.start({ sessionId, prompt: normalizedPrompt });
      queryClient.setQueryData<HostedAgentConversation>(queryKey, (current) => ({
        sessionId,
        messages: [
          ...(current?.messages ?? []),
          {
            id: `optimistic-${accepted.runId}`,
            role: 'user',
            text: normalizedPrompt,
            isPending: true,
          },
        ],
        activeRun: {
          runId: accepted.runId,
          acceptedAt: accepted.acceptedAt,
        },
      }));
      return true;
    } catch (startError) {
      setError(`Could not start the run: ${formatError(startError)}`);
      try {
        queryClient.setQueryData(queryKey, await client.readConversation(sessionId));
      } catch {
        // Keep the actionable start error; the normal query retry remains available.
      }
      return false;
    } finally {
      setIsStarting(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (!activeRunId || isStopping) {
      return;
    }
    setIsStopping(true);
    setError(undefined);
    try {
      const result = await client.runs.cancel(activeRunId);
      if (!result.cancelled) {
        queryClient.setQueryData(queryKey, await client.readConversation(sessionId));
      }
    } catch (cancelError) {
      setError(`Could not stop the run: ${formatError(cancelError)}`);
    } finally {
      setIsStopping(false);
    }
  };

  const reset = async (): Promise<void> => {
    if (activeRunId || isResetting) {
      return;
    }
    setIsResetting(true);
    setError(undefined);
    try {
      const resetConversation = await client.resetConversation(sessionId);
      queryClient.setQueryData(queryKey, resetConversation);
      clearHostedAgentRunCheckpoint(storage, sessionId);
      setActivities([]);
      setLiveAssistantText('');
    } catch (resetError) {
      setError(`Could not reset the conversation: ${formatError(resetError)}`);
    } finally {
      setIsResetting(false);
    }
  };

  return {
    conversation: conversationQuery.data,
    activities,
    liveAssistantText,
    error: error ?? (conversationQuery.error ? formatError(conversationQuery.error) : undefined),
    recoveryWarning,
    isLoading: conversationQuery.isLoading,
    isRunning: Boolean(activeRunId),
    isStarting,
    isStopping,
    isResetting,
    submit,
    stop,
    reset,
    retryConnection: () => {
      setError(undefined);
      setConnectionRevision((revision) => revision + 1);
    },
  };
}

function hostedConversationQueryKey(sessionId: string) {
  return ['hosted-agent-conversation', sessionId] as const;
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = window.setTimeout(finish, delayMs);
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

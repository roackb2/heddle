import { FileConversationSessionService } from '@/core/chat/engine/sessions/service.js';
import { ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession, TurnSummary } from '@/core/chat/types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ConversationActivity } from '@/core/live/index.js';
import { ControlPlaneChatSessionPresenter } from './chat-session-presenter.js';

type BrowserIntegrationFakePromptInput = {
  workspaceId: string;
  workspaceRoot: string;
  stateRoot: string;
  sessionId: string;
  sessionStoragePath: string;
  prompt: string;
  runId: string;
  publishActivity: (activity: ConversationActivity) => void;
  agentSnapshot?: CustomAgentExecutionSnapshot;
};

const DEFAULT_STREAM_PREVIEW_DELAY_MS = 750;

/**
 * Owns the browser-integration fake session mutation path used by smoke tests.
 */
export class ControlPlaneChatSessionBrowserIntegrationFake {
  /**
   * Persists a deterministic fake turn through the same session files that the
   * browser integration smoke tests observe.
   */
  static async run(args: BrowserIntegrationFakePromptInput) {
    // Desired shape: fake browser integration should become an injectable engine test host.
    // Until then it still uses the public session service, so fake execution
    // exercises the same optimistic-concurrency boundary as real turns.
    const sessions = new FileConversationSessionService(args);
    const session = await sessions.read(args.sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }

    const timestamp = new Date().toISOString();
    const assistantText = `Mocked browser integration agent response: ${args.prompt}`;
    await ControlPlaneChatSessionBrowserIntegrationFake.emitStreamPreview(args, assistantText);
    const nextHistory = [
      ...session.history,
      { role: 'user' as const, content: args.prompt },
      { role: 'assistant' as const, content: assistantText },
    ];
    const nextTurn: TurnSummary = {
      id: `browser-integration-turn-${Date.now()}`,
      prompt: args.prompt,
      outcome: 'done',
      summary: assistantText,
      steps: 1,
      traceFile: 'browser-integration-fake-trace.jsonl',
      events: ['Mocked browser integration session run completed.'],
      agent: args.agentSnapshot ? {
        id: args.agentSnapshot.agentProfileId,
        name: args.agentSnapshot.agentName,
        modeAlias: args.agentSnapshot.modeAlias,
        source: args.agentSnapshot.source,
        definitionHash: args.agentSnapshot.definitionHash,
      } : undefined,
      agentSnapshot: args.agentSnapshot,
    };
    const updatedSession = await sessions.update(args.sessionId, (current): ChatSession => ({
      ...current,
      history: nextHistory,
      messages: ConversationLines.fromHistory(nextHistory),
      turns: [...current.turns, nextTurn].slice(-8),
      updatedAt: timestamp,
      lastContinuePrompt: args.prompt,
      lease: undefined,
    }));
    if (!updatedSession) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }

    return {
      outcome: 'done',
      summary: assistantText,
      session: ControlPlaneChatSessionPresenter.projectDetail(updatedSession)[0] ?? null,
    };
  }

  private static async emitStreamPreview(args: BrowserIntegrationFakePromptInput, assistantText: string): Promise<void> {
    // The browser-integration fake has to emit a real live activity before its
    // final mutation result so web-v2 can regression-test incremental streaming.
    const timestamp = new Date().toISOString();

    args.publishActivity({
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: args.runId,
      step: 1,
      text: assistantText.slice(0, 'Mocked browser integration agent response'.length),
      done: false,
      timestamp,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, ControlPlaneChatSessionBrowserIntegrationFake.resolveStreamPreviewDelayMs());
    });
  }

  private static resolveStreamPreviewDelayMs(): number {
    const configuredDelay = process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_STREAM_PREVIEW_MS;
    if (!configuredDelay) {
      return DEFAULT_STREAM_PREVIEW_DELAY_MS;
    }

    const delayMs = Number(configuredDelay);
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new Error('HEDDLE_BROWSER_INTEGRATION_FAKE_STREAM_PREVIEW_MS must be a non-negative integer.');
    }

    return delayMs;
  }
}

import type { EventEmitter } from 'node:events';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession, TurnSummary } from '@/core/chat/types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import { ControlPlaneChatSessionEventsController } from './chat-session-events.js';
import { ControlPlaneChatSessionPresenter } from './chat-session-presenter.js';

type BrowserIntegrationFakePromptInput = {
  eventBus: EventEmitter;
  workspaceId: string;
  sessionId: string;
  sessionStoragePath: string;
  prompt: string;
  agentSnapshot?: CustomAgentExecutionSnapshot;
};

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
    // This remains the only control-plane session path that should mutate the
    // file repository directly.
    const repository = new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath });
    const session = repository.read(args.sessionId);
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
    const latestSession = repository.read(args.sessionId) ?? session;
    const updatedSession: ChatSession = {
      ...session,
      history: nextHistory,
      messages: ConversationLines.fromHistory(nextHistory),
      turns: [...session.turns, nextTurn].slice(-8),
      updatedAt: timestamp,
      lastContinuePrompt: args.prompt,
      lease: undefined,
      queuedPrompts: latestSession.queuedPrompts,
    };

    repository.save(
      repository.readCatalog()
        .map((entry) => repository.read(entry.id))
        .filter((candidate): candidate is ChatSession => Boolean(candidate))
        .map((candidate) => candidate.id === session.id ? updatedSession : candidate),
    );

    return {
      outcome: 'done',
      summary: assistantText,
      session: ControlPlaneChatSessionPresenter.projectDetail(updatedSession)[0] ?? null,
    };
  }

  private static async emitStreamPreview(args: BrowserIntegrationFakePromptInput, assistantText: string): Promise<void> {
    // The browser-integration fake has to emit a real live activity before its
    // final mutation result so web-v2 can regression-test incremental streaming.
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: args.eventBus,
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
    });
    const runId = `browser-integration-run-${Date.now()}`;
    const timestamp = new Date().toISOString();

    publisher.publishActivity({
      source: 'agent-loop',
      type: 'assistant.stream',
      runId,
      step: 1,
      text: assistantText.slice(0, 'Mocked browser integration agent response'.length),
      done: false,
      timestamp,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 750);
    });
  }
}

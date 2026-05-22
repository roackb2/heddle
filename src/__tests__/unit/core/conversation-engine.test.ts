import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationEngine } from '../../../core/chat/engine/conversation-engine.js';
import { EngineConversationTurnService } from '../../../core/chat/engine/turns/service.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { TraceEvent } from '../../../core/types.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';
import type { ChatSession } from '../../../core/chat/types.js';
import { TraceSummaryService } from '@/core/observability/index.js';

describe('createConversationEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(EngineConversationTurnService, 'run').mockImplementation(async (args) => ({
      outcome: 'done',
      summary: 'ok',
      session: new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
        .read(args.sessionId, true) as ChatSession,
    }));
  });

  it('derives the default session storage path from stateRoot and persists session defaults', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
      apiKeyPresent: true,
    });

    expect(engine.sessions.listExisting()).toEqual([]);
    const fallback = engine.sessions.latest();
    expect(fallback).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
    expect(engine.sessions.require('session-1')).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.4',
    }));

    const session = engine.sessions.create({ name: 'Repo investigation' });

    expect(engine.sessions.listExisting().map((candidate) => candidate.id)).toEqual([session.id, 'session-1']);
    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    expect(sessionRepository.readCatalog()[0]).toEqual(expect.objectContaining({
      id: session.id,
      name: 'Repo investigation',
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
    expect(sessionRepository.read(session.id, true)).toEqual(expect.objectContaining({
      id: session.id,
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
  });

  it('lists sessions in persisted storage order, reads missing sessions as undefined, updates, renames, and deletes with fallback', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });

    const first = engine.sessions.create({ id: 'session-a', name: 'First' });
    const second = engine.sessions.create({ id: 'session-b', name: 'Second' });

    expect(engine.sessions.list().map((session) => session.id)).toEqual(['session-b', 'session-a']);
    expect(engine.sessions.latest()?.id).toBe(engine.sessions.list()[0]?.id);
    expect(engine.sessions.read('missing')).toBeUndefined();
    expect(engine.sessions.require(first.id).id).toBe(first.id);
    expect(() => engine.sessions.require('missing')).toThrow('Chat session not found: missing');

    const updated = engine.sessions.update(first.id, (session) => ({
      ...session,
      driftEnabled: true,
    }));
    expect(updated?.driftEnabled).toBe(true);
    expect(engine.sessions.read(first.id)?.driftEnabled).toBe(true);

    const renamed = engine.sessions.rename(first.id, 'Renamed');
    expect(renamed.name).toBe('Renamed');
    expect(engine.sessions.read(first.id)?.name).toBe('Renamed');

    expect(engine.sessions.delete(second.id)).toBe(true);
    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    expect(sessionRepository.list(true).map((session) => session.id)).toEqual(['session-a']);
    expect(engine.sessions.delete(first.id)).toBe(true);
    expect(engine.sessions.delete('session-1')).toBe(true);
    expect(engine.sessions.delete('missing')).toBe(false);
    expect(sessionRepository.list(true).map((session) => session.id)).toEqual(['session-1']);
  });

  it('updates shared session settings for TUI and control-plane clients', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({
      id: 'session-1',
      name: 'Alpha',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    const updated = engine.sessions.updateSettings(session.id, {
      model: 'gpt-5.5',
      reasoningEffort: null,
      driftEnabled: true,
    });

    expect(updated).toEqual(expect.objectContaining({
      id: session.id,
      name: 'Alpha',
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      driftEnabled: true,
      history: session.history,
      messages: session.messages,
      turns: session.turns,
    }));
    expect(engine.sessions.read(session.id)).toEqual(expect.objectContaining({
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      driftEnabled: true,
    }));
    expect(() => engine.sessions.updateSettings('missing', { driftEnabled: false })).toThrow(
      'Chat session not found: missing',
    );
  });

  it('owns persisted conversation message, reset, continue prompt, and drift mutations', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });

    const withUserMessage = engine.sessions.appendMessage(session.id, {
      id: 'message-1',
      role: 'user',
      text: 'Inspect README',
    });
    expect(withUserMessage.messages.at(-1)).toEqual({
      id: 'message-1',
      role: 'user',
      text: 'Inspect README',
    });

    const withAssistantMessages = engine.sessions.appendMessages(session.id, [
      {
        id: 'message-2',
        role: 'assistant',
        text: 'Looking now',
        isStreaming: true,
      },
      {
        id: 'message-3',
        role: 'assistant',
        text: 'Done',
      },
    ]);
    expect(withAssistantMessages.messages.slice(-2)).toEqual([
      {
        id: 'message-2',
        role: 'assistant',
        text: 'Looking now',
        isStreaming: true,
      },
      {
        id: 'message-3',
        role: 'assistant',
        text: 'Done',
      },
    ]);

    const withPrompt = engine.sessions.setLastContinuePrompt(session.id, 'Continue the repo read');
    expect(withPrompt.lastContinuePrompt).toBe('Continue the repo read');

    const withDrift = engine.sessions.setDriftEnabled(session.id, true);
    expect(withDrift.driftEnabled).toBe(true);

    const reset = engine.sessions.resetConversation(session.id, { apiKeyPresent: false });
    expect(reset.history).toEqual([]);
    expect(reset.turns).toEqual([]);
    expect(reset.lastContinuePrompt).toBeUndefined();
    expect(reset.messages.map((message) => message.id)).toEqual(['intro', 'missing-key']);
    expect(engine.sessions.read(session.id)).toEqual(expect.objectContaining({
      driftEnabled: true,
      messages: expect.arrayContaining([
        expect.objectContaining({ id: 'intro' }),
        expect.objectContaining({ id: 'missing-key' }),
      ]),
    }));
  });

  it('owns persisted compaction state transitions', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const sourceHistory = [{ role: 'user' as const, content: 'Inspect README' }];
    const previousState = engine.sessions.update(session.id, (current) => ({
      ...current,
      context: {
        estimatedHistoryTokens: 7,
        compaction: { status: 'idle' },
        archive: {
          currentSummaryPath: '.heddle/chat-sessions/session-1/current-summary.md',
        },
      },
      archives: [
        {
          id: 'archive-1',
          path: '.heddle/chat-sessions/session-1/archive.jsonl',
          summaryPath: '.heddle/chat-sessions/session-1/archive-summary.md',
          messageCount: 2,
          createdAt: '2026-05-15T00:00:00.000Z',
        },
      ],
    }))!;

    const running = engine.sessions.markCompactionRunning(session.id, {
      sourceHistory,
      archivePath: '.heddle/chat-sessions/session-1/archive.jsonl',
    });
    expect(running.history).toEqual(sourceHistory);
    expect(running.context).toEqual(expect.objectContaining({
      compaction: expect.objectContaining({ status: 'running' }),
      archive: expect.objectContaining({ lastArchivePath: '.heddle/chat-sessions/session-1/archive.jsonl' }),
    }));

    const compacted = engine.sessions.applyCompactionResult(session.id, {
      history: [
        { role: 'user', content: 'Short prompt' },
        { role: 'assistant', content: 'Short answer' },
      ],
      context: {
        estimatedHistoryTokens: 4,
        compaction: { status: 'idle' },
      },
      archive: {
        archives: [],
      },
    });
    expect(compacted.messages.map((message) => message.text)).toEqual(['Short prompt', 'Short answer']);
    expect(compacted.context?.compaction?.status).toBe('idle');

    const restored = engine.sessions.restoreCompactionState(session.id, {
      context: previousState.context,
      archives: previousState.archives,
    });
    expect(restored.context).toEqual(previousState.context);
    expect(restored.archives).toEqual(previousState.archives);
  });

  it('owns session lease conflict, acquire, and release semantics', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const owner = {
      ownerKind: 'tui' as const,
      ownerId: 'tui-test-client',
      clientLabel: 'terminal chat',
    };
    const otherOwner = {
      ownerKind: 'daemon' as const,
      ownerId: 'daemon-1',
      clientLabel: 'control plane',
    };

    expect(engine.sessions.getLeaseConflict(session.id, owner)).toBeUndefined();
    const leased = engine.sessions.acquireLease(session.id, owner);
    expect(leased.lease).toEqual(expect.objectContaining({
      ownerKind: 'tui',
      ownerId: 'tui-test-client',
      clientLabel: 'terminal chat',
    }));
    expect(engine.sessions.getLeaseConflict(session.id, otherOwner)).toContain(
      'Session session-1 is already active in terminal chat.',
    );
    expect(() => engine.sessions.acquireLease(session.id, otherOwner)).toThrow(
      'Session session-1 is already active in terminal chat.',
    );

    const stillLeased = engine.sessions.releaseLease(session.id, { ownerId: 'daemon-1' });
    expect(stillLeased.lease?.ownerId).toBe('tui-test-client');

    const released = engine.sessions.releaseLease(session.id, owner);
    expect(released.lease).toBeUndefined();
    expect(engine.sessions.read(session.id)?.lease).toBeUndefined();
  });

  it('submits turns with merged engine defaults, normalized host callbacks, and override options', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const approvalPolicies = [vi.fn()];
    const traceSummarizerRegistry = new TraceSummaryService({ 'run.started': () => [] });
    vi.spyOn(traceSummarizerRegistry, 'summarizeTrace').mockReturnValue([]);
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKey: 'engine-key',
      preferApiKey: true,
      credentialStorePath: join(stateRoot, 'auth.json'),
      systemContext: 'Engine system context',
      memoryMaintenanceMode: 'background',
      approvalPolicies,
      traceSummarizerRegistry,
      workspaceId: 'workspace-1',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const onActivity = vi.fn();
    const onEvent = vi.fn();
    const onTraceEvent = vi.fn();
    const onCompactionStatus = vi.fn();
    const requestToolApproval = vi.fn(async () => ({ approved: true, reason: 'ok' }));
    const overridePolicies = [vi.fn()];
    const overrideRegistry = new TraceSummaryService({ 'run.started': () => [] });
    vi.spyOn(overrideRegistry, 'summarizeTrace').mockReturnValue([]);

    await engine.turns.submit({
      sessionId: session.id,
      prompt: 'Summarize the repo.',
      memoryMaintenanceMode: 'inline',
      approvalPolicies: overridePolicies as never,
      traceSummarizerRegistry: overrideRegistry,
      host: {
        events: {
          onActivity,
          onEvent,
        },
        approvals: {
          requestToolApproval,
        },
        compaction: {
          onStatus: onCompactionStatus,
        },
        trace: {
          onEvent: onTraceEvent,
        },
      },
    });

    const runSpy = vi.mocked(EngineConversationTurnService.run);
    const args = runSpy.mock.calls[0]?.[0];
    expect(args).toEqual(expect.objectContaining({
      workspaceRoot,
      stateRoot,
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
      sessionId: session.id,
      prompt: 'Summarize the repo.',
      apiKey: 'engine-key',
      preferApiKey: true,
      credentialStorePath: join(stateRoot, 'auth.json'),
      systemContext: 'Engine system context',
      memoryMaintenanceMode: 'inline',
      approvalPolicies: overridePolicies,
      traceSummarizerRegistry: overrideRegistry,
    }));
    expect(typeof args.onTraceEvent).toBe('function');
    expect(args.traceDir).toBe(join(stateRoot, 'traces'));
    expect(args.host).toBeTruthy();
    expect(typeof args.host.approveToolCall).toBe('function');

    const loopEvent: AgentLoopEvent = {
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'partial',
      done: false,
      timestamp: '2026-05-03T00:00:00.000Z',
    };
    args.host.onEvent(loopEvent);
    expect(onEvent).toHaveBeenCalledWith(loopEvent);
    expect(onActivity).toHaveBeenCalledWith(loopEvent);

    const traceEvent: TraceEvent = {
      type: 'tool.calling',
      step: 1,
      timestamp: '2026-05-03T00:00:01.000Z',
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
      requiresApproval: false,
    };
    args.onTraceEvent(traceEvent);
    expect(onTraceEvent).toHaveBeenCalledWith(traceEvent);
    expect(onActivity).toHaveBeenCalledTimes(1);

    const compactionActivity = {
      source: 'compaction' as const,
      type: 'compaction.finished' as const,
      status: 'finished' as const,
      summaryPath: '/tmp/summary.md',
    };
    args.host.onCompactionStatus(compactionActivity, 'final');
    expect(onCompactionStatus).toHaveBeenCalledWith(compactionActivity);
    expect(onActivity.mock.calls.at(-1)?.[0]).toEqual(compactionActivity);
  });

  it('continues from the persisted lastContinuePrompt and errors clearly when missing', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });

    await expect(engine.turns.continue({ sessionId: session.id })).rejects.toThrow(
      'There is no interrupted or prior run to continue yet.',
    );

    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    const stored = sessionRepository.read(session.id, true) as ChatSession;
    stored.lastContinuePrompt = 'continue investigating';
    stored.history = [{ role: 'user', content: 'prior' }];
    stored.updatedAt = '2026-05-03T00:00:00.000Z';
    const otherSessions = sessionRepository.list(true)
      .filter((candidate) => candidate.id !== session.id);
    sessionRepository.save([stored, ...otherSessions]);

    await engine.turns.continue({ sessionId: session.id });
    const runSpy = vi.mocked(EngineConversationTurnService.run);
    expect(runSpy.mock.calls[0]?.[0]?.prompt).toBe('continue investigating');

    await engine.turns.continue({ sessionId: session.id, prompt: 'override prompt' });
    expect(runSpy.mock.calls[1]?.[0]?.prompt).toBe('override prompt');
  });

  it('clears leases through the turn service boundary', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });

    expect(() => engine.turns.clearLease({
      sessionId: 'missing',
      owner: { ownerKind: 'daemon', ownerId: 'daemon-1', clientLabel: 'control plane' },
    })).not.toThrow();

    const session = engine.sessions.create({ id: 'session-1', name: 'Leased' });
    engine.sessions.acquireLease(session.id, {
      ownerKind: 'daemon',
      ownerId: 'daemon-1',
      clientLabel: 'control plane',
    });

    engine.turns.clearLease({
      sessionId: 'session-1',
      owner: { ownerKind: 'daemon', ownerId: 'daemon-1', clientLabel: 'control plane' },
    });

    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    expect(sessionRepository.read('session-1', true)?.lease).toBeUndefined();
  });
});
